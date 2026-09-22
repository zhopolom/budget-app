import type {
  Account,
  Category,
  EntryTransaction,
  Id,
  IsoDate,
  ManualTransactionType,
  TransferTransaction,
} from '../../types/entities'
import type { ValidationResult } from '../../types/validation'
import { isValidIsoDate } from '../../utils/dates'
import { Money, PARSE_ERROR_MESSAGES } from '../../utils/money'
import { isTransfer, type TransactionInput } from './model'

export const NOTE_MAX_LENGTH = 120

export type { TransactionInput }

/**
 * Состояние формы: сумма — ещё текст, счета и категория могут быть не выбраны.
 * Поля всех трёх типов держим рядом, чтобы переключение «Расход / Доход / Перевод»
 * не стирало уже введённое.
 */
export interface TransactionDraft {
  type: ManualTransactionType
  amountText: string
  categoryId: Id | null
  accountId: Id | null
  fromAccountId: Id | null
  toAccountId: Id | null
  date: IsoDate
  note: string
}

export type TransactionField = 'amount' | 'category' | 'account' | 'fromAccount' | 'toAccount' | 'date' | 'note'

interface ValidationContext {
  categories: readonly Category[]
  accounts: readonly Account[]
}

/**
 * @param baseline Черновик, с которого началось редактирование. Передаётся
 * только в режиме правки: он нужен, чтобы отличить уже существующий перевод
 * внутри счёта от попытки создать новый такой перевод.
 */
export function validateTransactionDraft(
  draft: TransactionDraft,
  { categories, accounts }: ValidationContext,
  baseline?: TransactionDraft,
): ValidationResult<TransactionInput, TransactionField> {
  const errors: Partial<Record<TransactionField, string>> = {}

  const parsed = Money.parse(draft.amountText)
  if (!parsed.ok) errors.amount = PARSE_ERROR_MESSAGES[parsed.error]
  else if (parsed.value === 0) errors.amount = PARSE_ERROR_MESSAGES.empty

  if (!isValidIsoDate(draft.date)) errors.date = 'Укажите дату'

  const note = draft.note.trim()
  if (note.length > NOTE_MAX_LENGTH) errors.note = `Не длиннее ${NOTE_MAX_LENGTH} символов`

  const common = { amount: parsed.ok ? parsed.value : 0, date: draft.date, note }
  const failed = (): ValidationResult<TransactionInput, TransactionField> => ({ ok: false, errors })

  if (draft.type === 'transfer') {
    const from = accounts.find((account) => account.id === draft.fromAccountId)
    const to = accounts.find((account) => account.id === draft.toAccountId)

    // Счета могли свести в один при удалении — тогда старый перевод стал
    // переводом внутри счёта. Событие уже произошло, менять его задним числом
    // нечем: запрет на сохранение заблокировал бы и правку комментария.
    // Но стоит пользователю тронуть счета — правило «откуда ≠ куда» возвращается.
    const keptSelfTransfer =
      baseline?.type === 'transfer' &&
      baseline.fromAccountId === draft.fromAccountId &&
      baseline.toAccountId === draft.toAccountId

    if (!from) errors.fromAccount = 'Выберите счёт'
    if (!to) errors.toAccount = 'Выберите счёт'
    if (from && to && from.id === to.id && !keptSelfTransfer) errors.toAccount = 'Выберите другой счёт'
    if (from && to && from.currency !== to.currency) errors.toAccount = 'Счета в разных валютах'

    if (Object.keys(errors).length > 0 || !parsed.ok || !from || !to) return failed()
    return { ok: true, value: { type: 'transfer', fromAccountId: from.id, toAccountId: to.id, ...common } }
  }

  const category = categories.find((item) => item.id === draft.categoryId)
  if (!category || category.type !== draft.type) errors.category = 'Выберите категорию'

  const account = accounts.find((item) => item.id === draft.accountId)
  if (!account) errors.account = 'Выберите счёт'

  if (Object.keys(errors).length > 0 || !parsed.ok || !category || !account) return failed()
  return { ok: true, value: { type: draft.type, categoryId: category.id, accountId: account.id, ...common } }
}

/** Корректировку форма не открывает: у неё свой экран, поэтому тип сужен до ручных операций. */
export function draftFromTransaction(transaction: EntryTransaction | TransferTransaction): TransactionDraft {
  const common = {
    amountText: Money.toInputString(transaction.amount),
    date: transaction.date,
    note: transaction.note,
  }

  if (isTransfer(transaction)) {
    return {
      type: 'transfer',
      categoryId: null,
      accountId: null,
      fromAccountId: transaction.fromAccountId,
      toAccountId: transaction.toAccountId,
      ...common,
    }
  }

  return {
    type: transaction.type,
    categoryId: transaction.categoryId,
    accountId: transaction.accountId,
    fromAccountId: null,
    toAccountId: null,
    ...common,
  }
}

/** Пустая форма: счёт по умолчанию и сегодняшняя дата. */
export function emptyDraft(accountId: Id | null, date: IsoDate): TransactionDraft {
  return {
    type: 'expense',
    amountText: '',
    categoryId: null,
    accountId,
    fromAccountId: accountId,
    toAccountId: null,
    date,
    note: '',
  }
}
