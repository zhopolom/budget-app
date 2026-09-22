import type { CurrencyCode, Transaction, TransactionType } from '../../types/entities'
import { Money } from '../../utils/money'
import { MISSING_CATEGORY } from '../categories/defaults'
import { signedAmount } from './calculations'
import { isAdjustment, isTransfer } from './model'
import type { TransactionView } from './views'

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  expense: 'Расход',
  income: 'Доход',
  transfer: 'Перевод',
  adjustment: 'Корректировка',
}

/** Перевод не привязан к категории, поэтому иконка у него общая. */
export const TRANSFER_ICON = '🔄'

/** Корректировка остатка по итогам сверки — тоже без категории. */
export const ADJUSTMENT_ICON = '⚖️'
export const ADJUSTMENT_TITLE = 'Корректировка остатка'

/** Сумма со знаком так, как её видит человек: расход и уменьшение — минус, перевод — без знака. */
export function formatSignedAmount(transaction: Transaction, currency: CurrencyCode): string {
  if (isTransfer(transaction)) return Money.format(transaction.amount, currency)
  return Money.format(signedAmount(transaction), currency, { sign: 'always' })
}

const MISSING_ACCOUNT = 'Удалённый счёт'

/** Иконка строки: эмодзи категории, у перевода — общий значок. */
export function transactionIcon(view: TransactionView): string {
  if (isTransfer(view.transaction)) return TRANSFER_ICON
  if (isAdjustment(view.transaction)) return ADJUSTMENT_ICON
  return view.category?.icon ?? MISSING_CATEGORY.icon
}

/** Заголовок строки: название категории, у перевода — «Карта → Наличные». */
export function transactionTitle(view: TransactionView): string {
  if (isTransfer(view.transaction)) {
    // Счета могли свести в один при удалении — тогда «Карта → Карта» выглядит
    // как ошибка, хотя перевод настоящий и когда-то был между двумя счетами
    if (view.transaction.fromAccountId === view.transaction.toAccountId) {
      return `Перевод внутри счёта · ${view.fromAccount?.name ?? MISSING_ACCOUNT}`
    }
    return `${view.fromAccount?.name ?? MISSING_ACCOUNT} → ${view.toAccount?.name ?? MISSING_ACCOUNT}`
  }
  if (isAdjustment(view.transaction)) return ADJUSTMENT_TITLE
  return view.category?.name ?? MISSING_CATEGORY.name
}

/** Короткое описание для диалогов: «Продукты, −430 ₴». */
export function describeTransaction(view: TransactionView, currency: CurrencyCode): string {
  return `${transactionTitle(view)}, ${formatSignedAmount(view.transaction, currency)}`
}
