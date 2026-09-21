import type { Account, Category, Id, IsoDate, Transaction, TransactionType } from '../../types/entities'
import type { ValidationResult } from '../../types/validation'
import { isValidIsoDate } from '../../utils/dates'
import { Money, PARSE_ERROR_MESSAGES } from '../../utils/money'

export const NOTE_MAX_LENGTH = 120

/** Данные операции без служебных полей — то, что создаёт или меняет пользователь. */
export type TransactionInput = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>

/** Состояние формы: сумма — ещё текст, категория и счёт могут быть не выбраны. */
export interface TransactionDraft {
  type: TransactionType
  amountText: string
  categoryId: Id | null
  accountId: Id | null
  date: IsoDate
  note: string
}

export type TransactionField = 'amount' | 'category' | 'account' | 'date' | 'note'

interface ValidationContext {
  categories: readonly Category[]
  accounts: readonly Account[]
}

export function validateTransactionDraft(
  draft: TransactionDraft,
  { categories, accounts }: ValidationContext,
): ValidationResult<TransactionInput, TransactionField> {
  const errors: Partial<Record<TransactionField, string>> = {}

  const parsed = Money.parse(draft.amountText)
  if (!parsed.ok) errors.amount = PARSE_ERROR_MESSAGES[parsed.error]
  else if (parsed.value === 0) errors.amount = PARSE_ERROR_MESSAGES.empty

  const category = categories.find((item) => item.id === draft.categoryId)
  if (!category || category.type !== draft.type) errors.category = 'Выберите категорию'

  if (!accounts.some((account) => account.id === draft.accountId)) errors.account = 'Выберите счёт'

  if (!isValidIsoDate(draft.date)) errors.date = 'Укажите дату'

  const note = draft.note.trim()
  if (note.length > NOTE_MAX_LENGTH) errors.note = `Не длиннее ${NOTE_MAX_LENGTH} символов`

  if (Object.keys(errors).length > 0 || !parsed.ok || !category || !draft.accountId) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      type: draft.type,
      amount: parsed.value,
      categoryId: category.id,
      accountId: draft.accountId,
      date: draft.date,
      note,
    },
  }
}

export function draftFromTransaction(transaction: Transaction): TransactionDraft {
  return {
    type: transaction.type,
    amountText: Money.toInputString(transaction.amount),
    categoryId: transaction.categoryId,
    accountId: transaction.accountId,
    date: transaction.date,
    note: transaction.note,
  }
}
