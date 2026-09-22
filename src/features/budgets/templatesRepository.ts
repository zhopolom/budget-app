import { db } from '../../db/database'
import type { BudgetTemplate, Id } from '../../types/entities'
import type { YearMonth } from '../../utils/dates'
import { createId } from '../../utils/id'
import { isNonNegativeMoneyAmount, isPositiveMoneyAmount } from '../../utils/money'
import { isSnapshotEmpty, planApplication, type ApplyMode, type ApplyPlan, type BudgetSnapshot } from './apply'
import { budgetIdFor, categoryBudgetIdFor } from './ids'

export const TEMPLATE_NAME_MAX_LENGTH = 40

/**
 * Шаблоны бюджета (ТЗ §35–§36) и копирование месяца (ТЗ §40). Общее у них
 * одно: снимок «общий лимит + лимиты категорий» применяется к месяцу по
 * плану из apply.ts. Месяцы после копирования никак не связаны.
 */

/** Бюджет месяца в виде снимка. Вызывать внутри транзакции над budgets и categoryBudgets. */
export async function snapshotOfMonth(month: YearMonth): Promise<BudgetSnapshot> {
  const [budget, limits] = await Promise.all([
    db.budgets.get(budgetIdFor(month)),
    db.categoryBudgets.where('[year+month]').equals([month.year, month.month]).toArray(),
  ])
  return {
    totalLimit: budget?.totalLimit ?? 0,
    categoryLimits: limits.map((limit) => ({
      categoryId: limit.categoryId,
      limitAmount: limit.limitAmount,
      ...(limit.rollover ? { rollover: true } : {}),
    })),
  }
}

function assertSnapshot(snapshot: BudgetSnapshot): void {
  if (!isNonNegativeMoneyAmount(snapshot.totalLimit)) throw new RangeError('Общий лимит вне допустимых пределов')
  for (const limit of snapshot.categoryLimits) {
    if (!isPositiveMoneyAmount(limit.limitAmount)) throw new RangeError('Лимит категории вне допустимых пределов')
  }
}

function assertName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('Введите название шаблона')
  if (trimmed.length > TEMPLATE_NAME_MAX_LENGTH) throw new Error(`Не длиннее ${TEMPLATE_NAME_MAX_LENGTH} символов`)
  return trimmed
}

/**
 * Применяет снимок к месяцу ровно по плану, который видел пользователь.
 * Вызывать внутри транзакции над budgets, categoryBudgets и categories.
 */
export async function applySnapshotToMonth(month: YearMonth, source: BudgetSnapshot, mode: ApplyMode): Promise<ApplyPlan> {
  assertSnapshot(source)
  const [existing, categories] = await Promise.all([snapshotOfMonth(month), db.categories.toArray()])
  const plan = planApplication(source, existing, mode, new Set(categories.map((category) => category.id)))
  const now = Date.now()

  if (plan.total) {
    if (plan.total.to === 0) await db.budgets.delete(budgetIdFor(month))
    else await db.budgets.put({ id: budgetIdFor(month), year: month.year, month: month.month, totalLimit: plan.total.to })
  }

  for (const id of plan.removed) await db.categoryBudgets.delete(categoryBudgetIdFor(month, id))

  for (const limit of [...plan.added, ...plan.changed]) {
    const id = categoryBudgetIdFor(month, limit.categoryId)
    const current = await db.categoryBudgets.get(id)
    await db.categoryBudgets.put({
      id,
      categoryId: limit.categoryId,
      year: month.year,
      month: month.month,
      limitAmount: limit.limitAmount,
      ...(limit.rollover ? { rollover: true } : {}),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    })
  }

  return plan
}

export const templatesRepository = {
  listAll(): Promise<BudgetTemplate[]> {
    return db.budgetTemplates.orderBy('createdAt').toArray()
  },

  get(id: Id): Promise<BudgetTemplate | undefined> {
    return db.budgetTemplates.get(id)
  },

  /** Шаблон из готового снимка: например, «Обычный месяц» с общим 20 000 и лимитами. */
  async create(name: string, snapshot: BudgetSnapshot): Promise<BudgetTemplate> {
    const trimmed = assertName(name)
    assertSnapshot(snapshot)
    if (isSnapshotEmpty(snapshot)) throw new Error('В шаблоне нет ни общего бюджета, ни лимитов')

    const now = Date.now()
    const template: BudgetTemplate = {
      id: createId(),
      name: trimmed,
      totalLimit: snapshot.totalLimit,
      // Перенос остатка — свойство конкретного месяца, шаблон его не знает
      categoryLimits: snapshot.categoryLimits.map(({ categoryId, limitAmount }) => ({ categoryId, limitAmount })),
      createdAt: now,
      updatedAt: now,
    }
    await db.budgetTemplates.add(template)
    return template
  },

  /** Шаблон из бюджета месяца — так он и появляется у пользователя. */
  createFromMonth(name: string, month: YearMonth): Promise<BudgetTemplate> {
    return db.transaction('rw', db.budgets, db.categoryBudgets, db.budgetTemplates, async () => {
      const snapshot = await snapshotOfMonth(month)
      if (isSnapshotEmpty(snapshot)) throw new Error('В этом месяце нет бюджета — сохранять нечего')
      return templatesRepository.create(name, snapshot)
    })
  },

  async rename(id: Id, name: string): Promise<void> {
    const updated = await db.budgetTemplates.update(id, { name: assertName(name), updatedAt: Date.now() })
    if (updated === 0) throw new Error('Шаблон не найден')
  },

  remove(id: Id): Promise<void> {
    return db.budgetTemplates.delete(id)
  },

  /** Применяет шаблон к месяцу. Превью строится тем же planApplication, что и запись. */
  applyToMonth(templateId: Id, month: YearMonth, mode: ApplyMode): Promise<ApplyPlan> {
    return db.transaction('rw', db.budgets, db.categoryBudgets, db.categories, db.budgetTemplates, async () => {
      const template = await db.budgetTemplates.get(templateId)
      if (!template) throw new Error('Шаблон не найден')
      return applySnapshotToMonth(month, { totalLimit: template.totalLimit, categoryLimits: template.categoryLimits }, mode)
    })
  },

  /**
   * Копирует бюджет одного месяца в другой: общий лимит, лимиты и флаги переноса.
   * Месяцы после этого не связаны — правка одного не трогает другой.
   */
  copyMonth(source: YearMonth, target: YearMonth, mode: ApplyMode): Promise<ApplyPlan> {
    if (source.year === target.year && source.month === target.month) throw new Error('Это тот же месяц')
    return db.transaction('rw', db.budgets, db.categoryBudgets, db.categories, async () => {
      const snapshot = await snapshotOfMonth(source)
      if (isSnapshotEmpty(snapshot)) throw new Error('В исходном месяце нет бюджета — копировать нечего')
      return applySnapshotToMonth(target, snapshot, mode)
    })
  },

  /** Убирает категорию из всех шаблонов — при её удалении ссылка не должна остаться. */
  async dropCategory(categoryId: Id): Promise<number> {
    const templates = await db.budgetTemplates.toArray()
    let touched = 0
    for (const template of templates) {
      const kept = template.categoryLimits.filter((limit) => limit.categoryId !== categoryId)
      if (kept.length === template.categoryLimits.length) continue
      await db.budgetTemplates.update(template.id, { categoryLimits: kept, updatedAt: Date.now() })
      touched += 1
    }
    return touched
  },
}
