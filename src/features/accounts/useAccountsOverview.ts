import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import type { Account, CurrencyCode, MinorUnits } from '../../types/entities'
import { Money } from '../../utils/money'
import { settingsRepository } from '../settings/repository'
import { calculateAccountBalances } from '../transactions/calculations'
import { accountsRepository } from './repository'

export interface AccountWithBalance {
  account: Account
  balance: MinorUnits
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
        const items = accounts.map((account) => ({ account, balance: balances.get(account.id) ?? 0 }))
        return { items, total: Money.sum(items.map((item) => item.balance)), currency: settings.baseCurrency }
      }),
    [],
  )
}
