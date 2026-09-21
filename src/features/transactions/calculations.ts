import type { Account, Category, Id, MinorUnits, Transaction } from '../../types/entities'
import { Money } from '../../utils/money'

type AmountLike = Pick<Transaction, 'type' | 'amount'>

/** Расход — отрицательный, доход — положительный. */
export function signedAmount(transaction: AmountLike): MinorUnits {
  return transaction.type === 'expense' ? -transaction.amount : transaction.amount
}

export interface Totals {
  income: MinorUnits
  expense: MinorUnits
  /** income − expense */
  net: MinorUnits
}

export function calculateTotals(transactions: readonly AmountLike[]): Totals {
  let income = 0
  let expense = 0
  for (const transaction of transactions) {
    if (transaction.type === 'income') income = Money.add(income, transaction.amount)
    else expense = Money.add(expense, transaction.amount)
  }
  return { income, expense, net: Money.subtract(income, expense) }
}

/** Общий баланс: начальные остатки всех счетов + все доходы − все расходы. */
export function calculateTotalBalance(
  accounts: readonly Pick<Account, 'initialBalance'>[],
  transactions: readonly AmountLike[],
): MinorUnits {
  const initial = Money.sum(accounts.map((account) => account.initialBalance))
  return Money.add(initial, calculateTotals(transactions).net)
}

/** Новые сверху: по дате, внутри одного дня — по времени создания. */
export function compareNewestFirst(
  a: Pick<Transaction, 'date' | 'createdAt'>,
  b: Pick<Transaction, 'date' | 'createdAt'>,
): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  return b.createdAt - a.createdAt
}

/** Текущий остаток каждого счёта: начальный баланс + его доходы − его расходы. */
export function calculateAccountBalances(
  accounts: readonly Pick<Account, 'id' | 'initialBalance'>[],
  transactions: readonly Pick<Transaction, 'type' | 'amount' | 'accountId'>[],
): Map<Id, MinorUnits> {
  const balances = new Map(accounts.map((account) => [account.id, account.initialBalance]))
  for (const transaction of transactions) {
    const current = balances.get(transaction.accountId)
    // Операции удалённых счетов в остатки не попадают
    if (current !== undefined) balances.set(transaction.accountId, Money.add(current, signedAmount(transaction)))
  }
  return balances
}

/** Частые категории — первыми; при равенстве сохраняется исходный порядок. */
export function sortCategoriesByUsage<T extends Pick<Category, 'id'>>(
  categories: readonly T[],
  usage: ReadonlyMap<Id, number>,
): T[] {
  return categories
    .map((category, index) => ({ category, index, count: usage.get(category.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map(({ category }) => category)
}
