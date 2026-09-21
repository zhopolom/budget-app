import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import type { Account, AppSettings, Category, Id } from '../../types/entities'
import { accountsRepository } from '../accounts/repository'
import { categoriesRepository } from '../categories/repository'
import { settingsRepository } from '../settings/repository'
import { transactionsRepository } from './repository'

export interface TransactionEditorData {
  categories: Category[]
  categoryUsage: Map<Id, number>
  accounts: Account[]
  settings: AppSettings
}

/** Всё, что нужно форме операции. undefined — пока идёт чтение. */
export function useTransactionEditorData(): TransactionEditorData | undefined {
  return useLiveQuery(
    () =>
      db.transaction('r', [db.categories, db.transactions, db.accounts, db.settings], async () => {
        const [categories, categoryUsage, accounts, settings] = await Promise.all([
          categoriesRepository.listAll(),
          transactionsRepository.usageByCategory(),
          accountsRepository.listAll(),
          settingsRepository.get(),
        ])
        return { categories, categoryUsage, accounts, settings }
      }),
    [],
  )
}

/** Счёт по умолчанию: последний выбранный, если он ещё существует, иначе первый. */
export function pickDefaultAccountId(accounts: readonly Account[], lastAccountId: Id | null): Id | null {
  if (lastAccountId && accounts.some((account) => account.id === lastAccountId)) return lastAccountId
  return accounts[0]?.id ?? null
}
