import { db } from '../../db/database'
import type { Budget, CategoryBudget, Id, MinorUnits } from '../../types/entities'
import type { YearMonth } from '../../utils/dates'
import { budgetIdFor, categoryBudgetIdFor } from './ids'

export { budgetIdFor, categoryBudgetIdFor }

export const budgetsRepository = {
  getForMonth(ym: YearMonth): Promise<Budget | undefined> {
    return db.budgets.get(budgetIdFor(ym))
  },

  listAll(): Promise<Budget[]> {
    return db.budgets.toArray()
  },

  /** limit = 0 убирает общий бюджет месяца. */
  async setForMonth(ym: YearMonth, totalLimit: MinorUnits): Promise<void> {
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

  /** limitAmount = 0 убирает лимит категории на этот месяц. */
  async set(ym: YearMonth, categoryId: Id, limitAmount: MinorUnits): Promise<void> {
    const id = categoryBudgetIdFor(ym, categoryId)
    if (limitAmount <= 0) {
      await db.categoryBudgets.delete(id)
      return
    }

    const now = Date.now()
    const existing = await db.categoryBudgets.get(id)
    await db.categoryBudgets.put({
      id,
      categoryId,
      year: ym.year,
      month: ym.month,
      limitAmount,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
  },

  /** Все лимиты категории — нужно при её удалении. */
  removeByCategory(categoryId: Id): Promise<number> {
    return db.categoryBudgets.where('categoryId').equals(categoryId).delete()
  },

  /**
   * Копирует лимиты предыдущего месяца в целевой. Уже заданные лимиты
   * не трогает, поэтому повторный вызов ничего не портит.
   * Возвращает число созданных лимитов.
   */
  async copyFrom(source: YearMonth, target: YearMonth): Promise<number> {
    return db.transaction('rw', db.categoryBudgets, async () => {
      const [from, to] = await Promise.all([
        categoryBudgetsRepository.listForMonth(source),
        categoryBudgetsRepository.listForMonth(target),
      ])
      const taken = new Set(to.map((item) => item.categoryId))
      const now = Date.now()

      const created = from
        .filter((item) => !taken.has(item.categoryId))
        .map((item) => ({
          id: categoryBudgetIdFor(target, item.categoryId),
          categoryId: item.categoryId,
          year: target.year,
          month: target.month,
          limitAmount: item.limitAmount,
          createdAt: now,
          updatedAt: now,
        }))

      if (created.length > 0) await db.categoryBudgets.bulkPut(created)
      return created.length
    })
  },
}
