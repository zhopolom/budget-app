import type { Account, Category, Id, MinorUnits, Transaction } from '../../types/entities'
import { Money } from '../../utils/money'
import { isEntry, isTransfer } from './model'

/** Расход — отрицательный, доход — положительный. У перевода знака нет. */
export function signedAmount(transaction: Transaction): MinorUnits {
  if (isTransfer(transaction)) return 0
  return transaction.type === 'expense' ? -transaction.amount : transaction.amount
}

export interface Totals {
  income: MinorUnits
  expense: MinorUnits
  /** income − expense */
  net: MinorUnits
}

/**
 * Доходы и расходы периода. Переводы сюда не попадают:
 * деньги не пришли и не ушли, они переложены между своими счетами.
 */
export function calculateTotals(transactions: readonly Transaction[]): Totals {
  let income = 0
  let expense = 0
  for (const transaction of transactions) {
    if (isTransfer(transaction)) continue
    if (transaction.type === 'income') income = Money.add(income, transaction.amount)
    else expense = Money.add(expense, transaction.amount)
  }
  return { income, expense, net: Money.subtract(income, expense) }
}

/**
 * Общий баланс: начальные остатки всех счетов + все доходы − все расходы.
 * Переводы общий капитал не меняют, поэтому в сумму не входят.
 */
export function calculateTotalBalance(
  accounts: readonly Pick<Account, 'initialBalance'>[],
  transactions: readonly Transaction[],
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

/**
 * Текущий остаток каждого счёта: начальный баланс, его доходы и расходы,
 * плюс переводы — со счёта-источника сумма уходит, на счёт-получатель приходит.
 */
export function calculateAccountBalances(
  accounts: readonly Pick<Account, 'id' | 'initialBalance'>[],
  transactions: readonly Transaction[],
): Map<Id, MinorUnits> {
  const balances = new Map(accounts.map((account) => [account.id, account.initialBalance]))

  // Операции удалённых счетов в остатки не попадают
  const apply = (accountId: Id, delta: MinorUnits) => {
    const current = balances.get(accountId)
    if (current !== undefined) balances.set(accountId, Money.add(current, delta))
  }

  for (const transaction of transactions) {
    if (isTransfer(transaction)) {
      apply(transaction.fromAccountId, -transaction.amount)
      apply(transaction.toAccountId, transaction.amount)
    } else {
      apply(transaction.accountId, signedAmount(transaction))
    }
  }

  return balances
}

/** Обороты одного счёта — для его карточки. */
export interface AccountActivity {
  income: MinorUnits
  expense: MinorUnits
  transferIn: MinorUnits
  transferOut: MinorUnits
  count: number
}

export function calculateAccountActivity(
  accountId: Id,
  transactions: readonly Transaction[],
): AccountActivity {
  const activity: AccountActivity = { income: 0, expense: 0, transferIn: 0, transferOut: 0, count: 0 }

  for (const transaction of transactions) {
    if (isTransfer(transaction)) {
      if (transaction.fromAccountId === accountId) {
        activity.transferOut = Money.add(activity.transferOut, transaction.amount)
        activity.count += 1
      }
      if (transaction.toAccountId === accountId) {
        activity.transferIn = Money.add(activity.transferIn, transaction.amount)
        // Перевод «на себя» валидацией запрещён, поэтому двойного счёта не будет
        if (transaction.fromAccountId !== accountId) activity.count += 1
      }
      continue
    }
    if (transaction.accountId !== accountId) continue
    activity.count += 1
    if (transaction.type === 'income') activity.income = Money.add(activity.income, transaction.amount)
    else activity.expense = Money.add(activity.expense, transaction.amount)
  }

  return activity
}

/** Расходы по категориям за период. Переводы и доходы не учитываются. */
export function calculateCategoryTotals(transactions: readonly Transaction[]): Map<Id, MinorUnits> {
  const totals = new Map<Id, MinorUnits>()
  for (const transaction of transactions) {
    if (!isEntry(transaction) || transaction.type !== 'expense') continue
    totals.set(transaction.categoryId, Money.add(totals.get(transaction.categoryId) ?? 0, transaction.amount))
  }
  return totals
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
