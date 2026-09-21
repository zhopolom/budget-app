import type {
  EntryTransaction,
  Id,
  MinorUnits,
  Transaction,
  TransferTransaction,
} from '../../types/entities'

/**
 * Работа с размеченным объединением Transaction.
 *
 * Всё, что раньше читало transaction.accountId напрямую, теперь идёт сюда:
 * у перевода счетов два, и ни один из них не «тот самый». Держим эти правила
 * в одном месте, чтобы перевод не мог случайно попасть в расходы.
 */

export function isTransfer(transaction: Transaction): transaction is TransferTransaction {
  return transaction.type === 'transfer'
}

export function isEntry(transaction: Transaction): transaction is EntryTransaction {
  return transaction.type !== 'transfer'
}

/** Счета, которых касается операция: один у расхода/дохода, два у перевода. */
export function accountIdsOf(transaction: Transaction): Id[] {
  return isTransfer(transaction)
    ? [transaction.fromAccountId, transaction.toAccountId]
    : [transaction.accountId]
}

export function touchesAccount(transaction: Transaction, accountId: Id): boolean {
  return accountIdsOf(transaction).includes(accountId)
}

/** Категория операции: у перевода её нет. */
export function categoryIdOf(transaction: Transaction): Id | null {
  return isTransfer(transaction) ? null : transaction.categoryId
}

/**
 * Как операция меняет остаток конкретного счёта.
 * Перевод забирает сумму с одного счёта и кладёт на другой — в сумме ноль.
 */
export function balanceDelta(transaction: Transaction, accountId: Id): MinorUnits {
  if (isTransfer(transaction)) {
    let delta = 0
    if (transaction.fromAccountId === accountId) delta -= transaction.amount
    if (transaction.toAccountId === accountId) delta += transaction.amount
    return delta
  }
  if (transaction.accountId !== accountId) return 0
  return transaction.type === 'expense' ? -transaction.amount : transaction.amount
}

/** Убирает служебные поля: то, что создаёт или меняет пользователь. */
export type TransactionInput =
  | Omit<EntryTransaction, 'id' | 'createdAt' | 'updatedAt'>
  | Omit<TransferTransaction, 'id' | 'createdAt' | 'updatedAt'>
