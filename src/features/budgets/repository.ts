import { db } from '../../db/database'
import { isNonNegativeMoneyAmount } from '../../utils/money'
import type { Budget, CategoryBudget, Id, MinorUnits } from '../../types/entities'
import type { YearMonth } from '../../utils/dates'
import { budgetIdFor, categoryBudgetIdFor } from './ids'

export { budgetIdFor, categoryBudgetIdFor }

/** Ноль снимает лимит, положительное — ставит; всё остальное (NaN, минус, больше максимума) — ошибка вызывающего. */
function assertLimit(value: unknown): void {
  if (!isNonNegativeMoneyAmount(value)) throw new RangeError('Лимит бюджета вне допустимых пределов')
}

export const budgetsRepository = {
  getForMonth(ym: YearMonth): Promise<Budget | undefined> {
    return db.budgets.get(budgetIdFor(ym))
  },

  listAll(): Promise<Budget[]> {
    return db.budgets.toArray()
  },

  /** limit = 0 убирает общий бюджет месяца. */
  async setForMonth(ym: YearMonth, totalLimit: MinorUnits): Promise<void> {
    assertLimit(totalLimit)
    const id = budgetIdFor(ym)
    if (totalLimit <= 0) {
      await db.budgets.delete(id)
      return
    }
    await db.budgets.put({ id, year: ym.year, month: ym.month, totalLimit })
  },
}

export const categoryBudgetsRepository = {
  listForMonth({ year, month }: YearMonth): Promise<CategoryBudget[]> {
    return db.categoryBudgets.where('[year+month]').equals([year, month]).toArray()
  },

  listAll(): Promise<CategoryBudget[]> {
    return db.categoryBudgets.toArray()
  },

  /**
   * limitAmount = 0 убирает лимит категории на этот месяц.
   * options.rollover — переносить ли остаток (ТЗ §37); не передан — флаг не меняется.
   */
  async set(ym: YearMonth, categoryId: Id, limitAmount: MinorUnits, options: { rollover?: boolean } = {}): Promise<void> {
    assertLimit(limitAmount)
    const id = categoryBudgetIdFor(ym, categoryId)
    if (limitAmount <= 0) {
      await db.categoryBudgets.delete(id)
      return
    }

    const now = Date.now()
    const existing = await db.categoryBudgets.get(id)
    const rollover = options.rollover ?? existing?.rollover ?? false
    await db.categoryBudgets.put({
      id,
      categoryId,
      year: ym.year,
      month: ym.month,
      limitAmount,
      // Флаг храним только включённым: у лимитов до 0.5 его нет, и это то же самое, что false
      ...(rollover ? { rollover: true } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
  },

  /** Все лимиты категории — нужно при её удалении. */
  removeByCategory(categoryId: Id): Promise<number> {
    return db.categoryBudgets.where('categoryId').equals(categoryId).delete()
  },
}
