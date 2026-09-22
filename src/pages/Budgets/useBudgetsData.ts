import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import type { BudgetSnapshot } from '../../features/budgets/apply'
import { budgetsRepository, categoryBudgetsRepository } from '../../features/budgets/repository'
import { snapshotOfMonth, templatesRepository } from '../../features/budgets/templatesRepository'
import { categoriesRepository } from '../../features/categories/repository'
import { settingsRepository } from '../../features/settings/repository'
import { calculateCategoryTotals } from '../../features/transactions/calculations'
import { transactionsRepository } from '../../features/transactions/repository'
import type { BudgetTemplate, Category, CurrencyCode, Id, MinorUnits } from '../../types/entities'
import { isSnapshotEmpty } from '../../features/budgets/apply'
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
  categories: Category[]
  /** Бюджет этого месяца одним снимком — для превью применения шаблона. */
  current: BudgetSnapshot
  /** Бюджет прошлого месяца; null — там пусто, копировать нечего. */
  previous: BudgetSnapshot | null
  templates: BudgetTemplate[]
}

async function loadBudgetsData(month: YearMonth): Promise<BudgetsData> {
  const { start, end } = monthDateRange(month)

  return db.transaction(
    'r',
    [db.settings, db.categories, db.transactions, db.budgets, db.categoryBudgets, db.budgetTemplates],
    async () => {
      const [settings, categories, monthTransactions, budget, limits, current, previous, templates] = await Promise.all([
        settingsRepository.get(),
        categoriesRepository.listAll(),
        transactionsRepository.listByDateRange(start, end),
        budgetsRepository.getForMonth(month),
        categoryBudgetsRepository.listForMonth(month),
        snapshotOfMonth(month),
        snapshotOfMonth(previousMonth(month)),
        templatesRepository.listAll(),
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

      return {
        currency: settings.baseCurrency,
        totalLimit: budget?.totalLimit ?? 0,
        monthExpense: [...spent.values()].reduce((sum, value) => sum + value, 0),
        rows,
        limitsTotal: limits.reduce((sum, item) => sum + item.limitAmount, 0),
        categories,
        current,
        previous: isSnapshotEmpty(previous) ? null : previous,
        templates,
      }
    },
  )
}

export function useBudgetsData(month: YearMonth): BudgetsData | undefined {
  return useLiveQuery(() => loadBudgetsData(month), [monthKey(month)])
}
