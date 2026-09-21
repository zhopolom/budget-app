import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import { buildMonthAnalytics, type MonthAnalytics } from '../../features/analytics/service'
import { accountsRepository } from '../../features/accounts/repository'
import { categoriesRepository } from '../../features/categories/repository'
import { settingsRepository } from '../../features/settings/repository'
import { calculateTotals } from '../../features/transactions/calculations'
import { transactionsRepository } from '../../features/transactions/repository'
import { toTransactionViews } from '../../features/transactions/views'
import type { CurrencyCode, IsoDate } from '../../types/entities'
import { monthDateRange, monthKey, previousMonth, type YearMonth } from '../../utils/dates'

export interface AnalyticsData extends MonthAnalytics {
  currency: CurrencyCode
}

/**
 * Читает два месяца: выбранный и предыдущий — для сравнения. Дальше всё
 * считает analyticsService, экран только рисует готовые цифры.
 */
async function loadAnalyticsData(month: YearMonth, today: IsoDate): Promise<AnalyticsData> {
  const current = monthDateRange(month)
  const previous = monthDateRange(previousMonth(month))

  return db.transaction('r', [db.settings, db.accounts, db.categories, db.transactions], async () => {
    const [settings, accounts, categories, transactions, previousTransactions] = await Promise.all([
      settingsRepository.get(),
      accountsRepository.listAll(),
      categoriesRepository.listAll(),
      transactionsRepository.listByDateRange(current.start, current.end),
      transactionsRepository.listByDateRange(previous.start, previous.end),
    ])

    const analytics = buildMonthAnalytics({
      month,
      today,
      views: toTransactionViews(transactions, categories, accounts),
      previousExpense: calculateTotals(previousTransactions).expense,
      categories,
    })

    return { ...analytics, currency: settings.baseCurrency }
  })
}

export function useAnalyticsData(month: YearMonth, today: IsoDate): AnalyticsData | undefined {
  return useLiveQuery(() => loadAnalyticsData(month, today), [monthKey(month), today])
}
