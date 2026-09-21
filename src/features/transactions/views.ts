import type { Account, Category, Transaction } from '../../types/entities'

/** Операция вместе со связанными сущностями — то, что нужно UI для отрисовки. */
export interface TransactionView {
  transaction: Transaction
  /** undefined, если категория была удалена. */
  category: Category | undefined
  /** undefined, если счёт был удалён. */
  account: Account | undefined
}

export function toTransactionViews(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  accounts: readonly Account[],
): TransactionView[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const accountById = new Map(accounts.map((account) => [account.id, account]))

  return transactions.map((transaction) => ({
    transaction,
    category: categoryById.get(transaction.categoryId),
    account: accountById.get(transaction.accountId),
  }))
}
