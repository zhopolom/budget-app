import type { CurrencyCode, TransactionType } from '../../types/entities'
import { Money } from '../../utils/money'
import { MISSING_CATEGORY } from '../categories/defaults'
import { isTransfer } from './model'
import type { TransactionView } from './views'

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  expense: 'Расход',
  income: 'Доход',
  transfer: 'Перевод',
}

/** Перевод не привязан к категории, поэтому иконка у него общая. */
export const TRANSFER_ICON = '🔄'

const MISSING_ACCOUNT = 'Удалённый счёт'

/** Иконка строки: эмодзи категории, у перевода — общий значок. */
export function transactionIcon(view: TransactionView): string {
  if (isTransfer(view.transaction)) return TRANSFER_ICON
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
  return view.category?.name ?? MISSING_CATEGORY.name
}

/** Короткое описание для диалогов: «Продукты, −430 ₴». */
export function describeTransaction(view: TransactionView, currency: CurrencyCode): string {
  const { transaction } = view
  const amount = isTransfer(transaction)
    ? Money.format(transaction.amount, currency)
    : Money.format(transaction.type === 'expense' ? -transaction.amount : transaction.amount, currency, {
        sign: 'always',
      })
  return `${transactionTitle(view)}, ${amount}`
}
