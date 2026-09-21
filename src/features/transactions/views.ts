import type { Account, Category, Id, Transaction } from '../../types/entities'
import { isTransfer } from './model'

/** Операция вместе со связанными сущностями — то, что нужно UI для отрисовки. */
export interface TransactionView {
  transaction: Transaction
  /** undefined у перевода и если категория была удалена. */
  category: Category | undefined
  /** Счёт расхода/дохода. undefined у перевода и если счёт был удалён. */
  account: Account | undefined
  /** Только у перевода. undefined, если счёт был удалён. */
  fromAccount: Account | undefined
  toAccount: Account | undefined
}

export function toTransactionViews(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  accounts: readonly Account[],
): TransactionView[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const account = (id: Id | undefined) => (id === undefined ? undefined : accountById.get(id))

  return transactions.map((transaction) => {
    if (isTransfer(transaction)) {
      return {
        transaction,
        category: undefined,
        account: undefined,
        fromAccount: account(transaction.fromAccountId),
        toAccount: account(transaction.toAccountId),
      }
    }
    return {
      transaction,
      category: categoryById.get(transaction.categoryId),
      account: account(transaction.accountId),
      fromAccount: undefined,
      toAccount: undefined,
    }
  })
}
