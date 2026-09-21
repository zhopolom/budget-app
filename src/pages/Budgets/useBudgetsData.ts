import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import { budgetsRepository, categoryBudgetsRepository } from '../../features/budgets/repository'
import { categoriesRepository } from '../../features/categories/repository'
import { settingsRepository } from '../../features/settings/repository'
import { calculateCategoryTotals } from '../../features/transactions/calculations'
import { transactionsRepository } from '../../features/transactions/repository'
import type { Category, CurrencyCode, Id, MinorUnits } from '../../types/entities'
import { monthDateRange, monthKey, previousMonth, type YearMonth } from '../../utils/dates'

export interface CategoryLimitRow {
  category: Category
  /** 0 — лимит не задан. */
  limit: MinorUnits
  spent: MinorUnits
}

export interface BudgetsData {
  currency: CurrencyCode
  totalLimit: MinorUnits
  /** Расходы месяца — чтобы показать лимит в контексте. */
  monthExpense: MinorUnits
  rows: CategoryLimitRow[]
  /** Сумма заданных лимитов категорий. */
  limitsTotal: MinorUnits
  /** Сколько лимитов можно перенести из прошлого месяца. */
  copyableFromPrevious: number
}

async function loadBudgetsData(month: YearMonth): Promise<BudgetsData> {
  const { start, end } = monthDateRange(month)

  return db.transaction(
    'r',
    [db.settings, db.categories, db.transactions, db.budgets, db.categoryBudgets],
    async () => {
      const [settings, categories, monthTransactions, budget, limits, previousLimits] = await Promise.all([
        settingsRepository.get(),
        categoriesRepository.listAll(),
        transactionsRepository.listByDateRange(start, end),
        budgetsRepository.getForMonth(month),
        categoryBudgetsRepository.listForMonth(month),
        categoryBudgetsRepository.listForMonth(previousMonth(month)),
      ])

      const spent = calculateCategoryTotals(monthTransactions)
      const limitByCategory = new Map<Id, MinorUnits>(limits.map((item) => [item.categoryId, item.limitAmount]))

      // Лимиты только у расходов: ограничивать доход нечем
      const rows = categories
        .filter((category) => category.type === 'expense')
        .map((category) => ({
          category,
          limit: limitByCategory.get(category.id) ?? 0,
          spent: spent.get(category.id) ?? 0,
        }))

      const taken = new Set(limits.map((item) => item.categoryId))
      const known = new Set(categories.map((category) => category.id))

      return {
        currency: settings.baseCurrency,
        totalLimit: budget?.totalLimit ?? 0,
        monthExpense: [...spent.values()].reduce((sum, value) => sum + value, 0),
        rows,
        limitsTotal: limits.reduce((sum, item) => sum + item.limitAmount, 0),
        copyableFromPrevious: previousLimits.filter(
          (item) => !taken.has(item.categoryId) && known.has(item.categoryId),
        ).length,
      }
    },
  )
}

export function useBudgetsData(month: YearMonth): BudgetsData | undefined {
  return useLiveQuery(() => loadBudgetsData(month), [monthKey(month)])
}
