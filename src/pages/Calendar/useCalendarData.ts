import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import { accountsRepository } from '../../features/accounts/repository'
import { categoriesRepository } from '../../features/categories/repository'
import { settingsRepository } from '../../features/settings/repository'
import { calculateTotals, type Totals } from '../../features/transactions/calculations'
import { dailyExpenses } from '../../features/transactions/grouping'
import { transactionsRepository } from '../../features/transactions/repository'
import { toTransactionViews, type TransactionView } from '../../features/transactions/views'
import type { CurrencyCode, IsoDate, MinorUnits } from '../../types/entities'
import { monthDateRange, monthKey, type YearMonth } from '../../utils/dates'

export interface CalendarData {
  /** Операции месяца — по ним строится и сетка, и список выбранного дня. */
  views: TransactionView[]
  expenses: Map<IsoDate, MinorUnits>
  /** Дни, в которых есть хоть одна операция. */
  active: Set<IsoDate>
  totals: Totals
  currency: CurrencyCode
}

/**
 * Одна выборка за месяц, дальше всё считается в памяти.
 * Отдельный запрос на каждый день дал бы 30 обращений к IndexedDB на экран.
 */
async function loadCalendarData(month: YearMonth): Promise<CalendarData> {
  const { start, end } = monthDateRange(month)

  return db.transaction('r', [db.settings, db.accounts, db.categories, db.transactions], async () => {
    const [settings, accounts, categories, transactions] = await Promise.all([
      settingsRepository.get(),
      accountsRepository.listAll(),
      categoriesRepository.listAll(),
      transactionsRepository.listByDateRange(start, end),
    ])

    const views = toTransactionViews(transactions, categories, accounts)

    return {
      views,
      expenses: dailyExpenses(views),
      active: new Set(transactions.map((transaction) => transaction.date)),
      totals: calculateTotals(transactions),
      currency: settings.baseCurrency,
    }
  })
}

export function useCalendarData(month: YearMonth): CalendarData | undefined {
  return useLiveQuery(() => loadCalendarData(month), [monthKey(month)])
}
