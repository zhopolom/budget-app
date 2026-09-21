import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import type { Account, CurrencyCode, Id, MinorUnits } from '../../types/entities'
import { Money } from '../../utils/money'
import { settingsRepository } from '../settings/repository'
import { calculateAccountBalances } from '../transactions/calculations'
import { accountIdsOf } from '../transactions/model'
import { accountsRepository } from './repository'

export interface AccountWithBalance {
  account: Account
  balance: MinorUnits
  /** Сколько операций касается счёта; перевод считается один раз для каждой стороны. */
  count: number
}

export interface AccountsOverview {
  items: AccountWithBalance[]
  total: MinorUnits
  currency: CurrencyCode
}

export function useAccountsOverview(): AccountsOverview | undefined {
  return useLiveQuery(
    () =>
      db.transaction('r', [db.accounts, db.transactions, db.settings], async () => {
        const [accounts, transactions, settings] = await Promise.all([
          accountsRepository.listAll(),
          db.transactions.toArray(),
          settingsRepository.get(),
        ])

        const balances = calculateAccountBalances(accounts, transactions)

        // Счётчик за тот же проход: отдельный count() на каждый счёт — это
        // по три запроса к индексам на счёт вместо одного чтения
        const counts = new Map<Id, number>()
        for (const transaction of transactions) {
          for (const accountId of new Set(accountIdsOf(transaction))) {
            counts.set(accountId, (counts.get(accountId) ?? 0) + 1)
          }
        }

        const items = accounts.map((account) => ({
          account,
          balance: balances.get(account.id) ?? 0,
          count: counts.get(account.id) ?? 0,
        }))

        return { items, total: Money.sum(items.map((item) => item.balance)), currency: settings.baseCurrency }
      }),
    [],
  )
}
