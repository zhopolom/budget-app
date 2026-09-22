import type { Account, Category, CurrencyCode, Id, RecurringTransaction } from '../../types/entities'
import { Money } from '../../utils/money'
import { MISSING_CATEGORY } from '../categories/defaults'
import { TRANSFER_ICON } from '../transactions/labels'
import { isRecurringTransfer } from './model'

const MISSING_ACCOUNT = 'Удалённый счёт'

/** Иконка расписания: эмодзи категории, у перевода — общий значок. */
export function recurringIcon(rule: RecurringTransaction, categories: readonly Category[]): string {
  if (isRecurringTransfer(rule)) return TRANSFER_ICON
  return categories.find((category) => category.id === rule.categoryId)?.icon ?? MISSING_CATEGORY.icon
}

/** Название: комментарий («Spotify»), а без него — категория или «Карта → Наличные». */
export function recurringTitle(
  rule: RecurringTransaction,
  categories: readonly Category[],
  accounts: readonly Account[],
): string {
  const note = rule.note.trim()
  if (note) return note

  if (isRecurringTransfer(rule)) {
    const name = (id: Id) => accounts.find((account) => account.id === id)?.name ?? MISSING_ACCOUNT
    return `${name(rule.fromAccountId)} → ${name(rule.toAccountId)}`
  }
  return categories.find((category) => category.id === rule.categoryId)?.name ?? MISSING_CATEGORY.name
}

/** Счета расписания словами: «Карта» или «Карта → Наличные». */
export function recurringAccountsLabel(rule: RecurringTransaction, accounts: readonly Account[]): string {
  const name = (id: Id) => accounts.find((account) => account.id === id)?.name ?? MISSING_ACCOUNT
  if (isRecurringTransfer(rule)) return `${name(rule.fromAccountId)} → ${name(rule.toAccountId)}`
  return name(rule.accountId)
}

/** Сумма со знаком по типу; у перевода знака нет — деньги не приходят и не уходят. */
export function formatRecurringAmount(rule: RecurringTransaction, currency: CurrencyCode): string {
  if (isRecurringTransfer(rule)) return Money.format(rule.amount, currency)
  return Money.format(rule.type === 'expense' ? -rule.amount : rule.amount, currency, { sign: 'always' })
}
