import type { Id, RecurringEntry, RecurringTransaction, RecurringTransfer } from '../../types/entities'

/**
 * Работа с размеченным объединением RecurringTransaction — по тем же правилам,
 * что и features/transactions/model.ts для самих операций.
 *
 * Всё, что раньше читало rule.accountId напрямую, идёт сюда: у регулярного
 * перевода счетов два, и ни один из них не «тот самый».
 */

export function isRecurringTransfer(rule: RecurringTransaction): rule is RecurringTransfer {
  return rule.type === 'transfer'
}

export function isRecurringEntry(rule: RecurringTransaction): rule is RecurringEntry {
  return rule.type !== 'transfer'
}

/** Счета, которых касается правило: один у расхода и дохода, два у перевода. */
export function recurringAccountIds(rule: RecurringTransaction): Id[] {
  return isRecurringTransfer(rule) ? [rule.fromAccountId, rule.toAccountId] : [rule.accountId]
}

export function recurringTouchesAccount(rule: RecurringTransaction, accountId: Id): boolean {
  return recurringAccountIds(rule).includes(accountId)
}

/** Категория правила: у перевода её нет. */
export function recurringCategoryId(rule: RecurringTransaction): Id | null {
  return isRecurringTransfer(rule) ? null : rule.categoryId
}

/** Правило, у которого обе стороны перевода указывают на один счёт: создавать такие нельзя. */
export function isSelfTransferRule(rule: RecurringTransaction): boolean {
  return isRecurringTransfer(rule) && rule.fromAccountId === rule.toAccountId
}
