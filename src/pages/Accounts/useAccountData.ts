import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import { accountsRepository } from '../../features/accounts/repository'
import { categoriesRepository } from '../../features/categories/repository'
import { settingsRepository } from '../../features/settings/repository'
import { calculateAccountActivity, calculateAccountBalances, type AccountActivity } from '../../features/transactions/calculations'
import { transactionsRepository } from '../../features/transactions/repository'
import { toTransactionViews, type TransactionView } from '../../features/transactions/views'
import type { Account, CurrencyCode, Id, MinorUnits } from '../../types/entities'
import { monthDateRange, monthKey, type YearMonth } from '../../utils/dates'

export interface AccountData {
  /** null — счёт удалён или id не найден. */
  account: Account | null
  /** Остаток за всю историю, а не за выбранный месяц. */
  balance: MinorUnits
  /** Обороты за выбранный месяц. */
  activity: AccountActivity
  /** Операции счёта за выбранный месяц. */
  views: TransactionView[]
  /** Всего операций по счёту за всю историю. */
  totalCount: number
  currency: CurrencyCode
}

async function loadAccountData(id: Id, month: YearMonth): Promise<AccountData> {
  const { start, end } = monthDateRange(month)

  return db.transaction('r', [db.settings, db.accounts, db.categories, db.transactions], async () => {
    const account = (await accountsRepository.get(id)) ?? null
    const [settings, accounts, categories, all, monthTransactions] = await Promise.all([
      settingsRepository.get(),
      accountsRepository.listAll(),
      categoriesRepository.listAll(),
      // Остаток считается по всей истории — иначе он был бы неверным
      transactionsRepository.listAll(),
      transactionsRepository.listByDateRange(start, end),
    ])

    const own = monthTransactions.filter((transaction) =>
      transaction.type === 'transfer'
        ? transaction.fromAccountId === id || transaction.toAccountId === id
        : transaction.accountId === id,
    )

    return {
      account,
      balance: calculateAccountBalances(accounts, all).get(id) ?? 0,
      activity: calculateAccountActivity(id, own),
      views: toTransactionViews(own, categories, accounts),
      totalCount: calculateAccountActivity(id, all).count,
      currency: settings.baseCurrency,
    }
  })
}

export function useAccountData(id: Id | null, month: YearMonth): AccountData | undefined {
  return useLiveQuery(
    () => (id ? loadAccountData(id, month) : Promise.resolve(emptyAccountData())),
    [id, monthKey(month)],
  )
}

function emptyAccountData(): AccountData {
  return {
    account: null,
    balance: 0,
    activity: { income: 0, expense: 0, transferIn: 0, transferOut: 0, count: 0 },
    views: [],
    totalCount: 0,
    currency: 'UAH',
  }
}
