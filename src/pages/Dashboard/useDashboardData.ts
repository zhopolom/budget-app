import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import { accountsRepository } from '../../features/accounts/repository'
import { calculateBudgetProgress, type BudgetProgress } from '../../features/budgets/calculations'
import { budgetsRepository } from '../../features/budgets/repository'
import { categoriesRepository } from '../../features/categories/repository'
import { settingsRepository } from '../../features/settings/repository'
import {
  calculateTotalBalance,
  calculateTotals,
  compareNewestFirst,
  type Totals,
} from '../../features/transactions/calculations'
import { transactionsRepository } from '../../features/transactions/repository'
import { toTransactionViews, type TransactionView } from '../../features/transactions/views'
import type { CurrencyCode, IsoDate, MinorUnits } from '../../types/entities'
import { fromIsoDate, monthDateRange, toYearMonth, type YearMonth } from '../../utils/dates'

const RECENT_LIMIT = 8

export interface DashboardData {
  month: YearMonth
  currency: CurrencyCode
  totalBalance: MinorUnits
  monthTotals: Totals
  budget: BudgetProgress | null
  recent: TransactionView[]
}

async function loadDashboardData(today: IsoDate): Promise<DashboardData> {
  const todayDate = fromIsoDate(today)
  const month = toYearMonth(todayDate)
  const { start, end } = monthDateRange(month)

  // Одна read-транзакция: все цифры считаются по согласованному снимку базы
  return db.transaction('r', [db.settings, db.accounts, db.categories, db.transactions, db.budgets], async () => {
    const [settings, accounts, categories, transactions, budget] = await Promise.all([
      settingsRepository.get(),
      accountsRepository.listAll(),
      categoriesRepository.listAll(),
      transactionsRepository.listAll(),
      budgetsRepository.getForMonth(month),
    ])

    const monthTransactions = transactions.filter((t) => t.date >= start && t.date <= end)
    const monthTotals = calculateTotals(monthTransactions)
    const recent = [...transactions].sort(compareNewestFirst).slice(0, RECENT_LIMIT)

    return {
      month,
      currency: settings.baseCurrency,
      totalBalance: calculateTotalBalance(accounts, transactions),
      monthTotals,
      budget: budget ? calculateBudgetProgress(budget.totalLimit, monthTotals.expense, month, todayDate) : null,
      recent: toTransactionViews(recent, categories, accounts),
    }
  })
}

/** undefined — пока идёт первое чтение. Обновляется автоматически при любом изменении данных. */
export function useDashboardData(today: IsoDate): DashboardData | undefined {
  return useLiveQuery(() => loadDashboardData(today), [today])
}
