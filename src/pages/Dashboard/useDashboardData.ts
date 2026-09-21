import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import { accountsRepository } from '../../features/accounts/repository'
import {
  buildCategoryBudgetProgress,
  calculateBudgetProgress,
  totalCategoryLimits,
  type BudgetProgress,
  type CategoryBudgetProgress,
} from '../../features/budgets/calculations'
import { budgetsRepository, categoryBudgetsRepository } from '../../features/budgets/repository'
import { categoriesRepository } from '../../features/categories/repository'
import { settingsRepository } from '../../features/settings/repository'
import {
  calculateCategoryTotals,
  calculateTotalBalance,
  calculateTotals,
  type Totals,
} from '../../features/transactions/calculations'
import { transactionsRepository } from '../../features/transactions/repository'
import { toTransactionViews, type TransactionView } from '../../features/transactions/views'
import type { CurrencyCode, IsoDate, MinorUnits } from '../../types/entities'
import { fromIsoDate, monthDateRange, monthKey, type YearMonth } from '../../utils/dates'

const RECENT_LIMIT = 8

export interface DashboardData {
  month: YearMonth
  currency: CurrencyCode
  totalBalance: MinorUnits
  monthTotals: Totals
  budget: BudgetProgress | null
  categoryBudgets: CategoryBudgetProgress[]
  categoryLimitsTotal: MinorUnits
  recent: TransactionView[]
}

async function loadDashboardData(month: YearMonth, today: IsoDate): Promise<DashboardData> {
  const todayDate = fromIsoDate(today)
  const { start, end } = monthDateRange(month)

  // Одна read-транзакция: все цифры считаются по согласованному снимку базы
  return db.transaction(
    'r',
    [db.settings, db.accounts, db.categories, db.transactions, db.budgets, db.categoryBudgets],
    async () => {
      const [settings, accounts, categories, allTransactions, monthTransactions, recent, budget, limits] =
        await Promise.all([
          settingsRepository.get(),
          accountsRepository.listAll(),
          categoriesRepository.listAll(),
          // Общий баланс считается по всей истории — иначе он был бы неверным
          transactionsRepository.listAll(),
          transactionsRepository.listByDateRange(start, end),
          // Последние — из индекса [date+createdAt], без сортировки всей истории
          db.transactions.orderBy('[date+createdAt]').reverse().limit(RECENT_LIMIT).toArray(),
          budgetsRepository.getForMonth(month),
          categoryBudgetsRepository.listForMonth(month),
        ])

      const monthTotals = calculateTotals(monthTransactions)
      const spentByCategory = calculateCategoryTotals(monthTransactions)

      return {
        month,
        currency: settings.baseCurrency,
        totalBalance: calculateTotalBalance(accounts, allTransactions),
        monthTotals,
        budget: budget ? calculateBudgetProgress(budget.totalLimit, monthTotals.expense, month, todayDate) : null,
        categoryBudgets: buildCategoryBudgetProgress(limits, spentByCategory, categories),
        categoryLimitsTotal: totalCategoryLimits(limits),
        recent: toTransactionViews(recent, categories, accounts),
      }
    },
  )
}

/** undefined — пока идёт первое чтение. Обновляется автоматически при любом изменении данных. */
export function useDashboardData(month: YearMonth, today: IsoDate): DashboardData | undefined {
  return useLiveQuery(() => loadDashboardData(month, today), [monthKey(month), today])
}
