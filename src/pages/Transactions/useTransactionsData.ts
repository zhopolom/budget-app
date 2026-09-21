import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import { accountsRepository } from '../../features/accounts/repository'
import { categoriesRepository } from '../../features/categories/repository'
import { settingsRepository } from '../../features/settings/repository'
import { resolvePeriod, type TransactionFilters } from '../../features/transactions/filters'
import { transactionsRepository } from '../../features/transactions/repository'
import { toTransactionViews, type TransactionView } from '../../features/transactions/views'
import type { Account, Category, CurrencyCode } from '../../types/entities'
import { monthKey, type YearMonth } from '../../utils/dates'

export interface TransactionsData {
  views: TransactionView[]
  accounts: Account[]
  categories: Category[]
  currency: CurrencyCode
}

/**
 * Читает только выбранный период, а не всю историю: за границы месяца
 * выходим, лишь когда пользователь сам попросил «Год» или «Всё время».
 */
async function loadTransactionsData(month: YearMonth, filters: TransactionFilters): Promise<TransactionsData> {
  const range = resolvePeriod(filters, month)

  return db.transaction('r', [db.settings, db.accounts, db.categories, db.transactions], async () => {
    const [settings, accounts, categories, transactions] = await Promise.all([
      settingsRepository.get(),
      accountsRepository.listAll(),
      categoriesRepository.listAll(),
      range ? transactionsRepository.listByDateRange(range.start, range.end) : transactionsRepository.listAll(),
    ])

    return {
      views: toTransactionViews(transactions, categories, accounts),
      accounts,
      categories,
      currency: settings.baseCurrency,
    }
  })
}

export function useTransactionsData(month: YearMonth, filters: TransactionFilters): TransactionsData | undefined {
  // Пересчитываем выборку только когда меняется период, а не любой фильтр:
  // тип, счёт и сумма отсеиваются уже в памяти
  return useLiveQuery(
    () => loadTransactionsData(month, filters),
    [monthKey(month), filters.period, filters.from, filters.to],
  )
}
