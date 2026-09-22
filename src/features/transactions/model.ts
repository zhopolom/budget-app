import type {
  AdjustmentTransaction,
  EntryTransaction,
  Id,
  MinorUnits,
  Transaction,
  TransactionSource,
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
  return transaction.type === 'expense' || transaction.type === 'income'
}

export function isAdjustment(transaction: Transaction): transaction is AdjustmentTransaction {
  return transaction.type === 'adjustment'
}

/** Счета, которых касается операция: один у расхода, дохода и корректировки, два у перевода. */
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
  return isEntry(transaction) ? transaction.categoryId : null
}

/** Знак корректировки: сверка нашла больше — плюс, меньше — минус. */
export function adjustmentDelta(transaction: AdjustmentTransaction): MinorUnits {
  return transaction.direction === 'increase' ? transaction.amount : -transaction.amount
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
  if (isAdjustment(transaction)) return adjustmentDelta(transaction)
  return transaction.type === 'expense' ? -transaction.amount : transaction.amount
}

/** Источник операции: у записей до 0.6 поля нет, но ответ известен по типу и связи с расписанием. */
export function transactionSourceOf(transaction: Transaction): TransactionSource {
  if (transaction.source) return transaction.source
  if (transaction.type === 'adjustment') return 'adjustment'
  return transaction.recurringId ? 'recurring' : 'manual'
}

/** Убирает служебные поля: то, что создаёт или меняет пользователь. */
export type TransactionInput =
  | Omit<EntryTransaction, 'id' | 'createdAt' | 'updatedAt'>
  | Omit<TransferTransaction, 'id' | 'createdAt' | 'updatedAt'>
  | Omit<AdjustmentTransaction, 'id' | 'createdAt' | 'updatedAt'>
