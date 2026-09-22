import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import { accountsRepository } from '../../features/accounts/repository'
import { categoriesRepository } from '../../features/categories/repository'
import { categoryRulesRepository } from '../../features/rules/repository'
import type { Account, Category, CategoryRule, Id } from '../../types/entities'

export interface RulesData {
  rules: CategoryRule[]
  categories: Category[]
  accounts: Account[]
  /** Описания расходов и доходов — для превью «совпадает с N операциями». */
  descriptions: { description: string; accountId: Id }[]
}

export function useRulesData(): RulesData | undefined {
  return useLiveQuery(
    () =>
      db.transaction('r', [db.categoryRules, db.categories, db.accounts, db.transactions], async () => {
        const [rules, categories, accounts, transactions] = await Promise.all([
          categoryRulesRepository.listAll(),
          categoriesRepository.listAll(),
          accountsRepository.listAll(),
          db.transactions.toArray(),
        ])
        const descriptions = transactions.flatMap((transaction) =>
          transaction.type === 'expense' || transaction.type === 'income'
            ? [{ description: transaction.note, accountId: transaction.accountId }]
            : [],
        )
        return { rules, categories, accounts, descriptions }
      }),
    [],
  )
}
