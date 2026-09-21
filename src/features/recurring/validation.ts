import type { Account, Category, EntryType, Id, IsoDate, RecurrenceFrequency, RecurringTransaction } from '../../types/entities'
import type { ValidationResult } from '../../types/validation'
import { isValidIsoDate } from '../../utils/dates'
import { Money, PARSE_ERROR_MESSAGES } from '../../utils/money'
import type { RecurringInput } from './repository'

export const RECURRING_NOTE_MAX_LENGTH = 120
export const MAX_INTERVAL = 99

export interface RecurringDraft {
  type: EntryType
  amountText: string
  categoryId: Id | null
  accountId: Id | null
  note: string
  frequency: RecurrenceFrequency
  intervalText: string
  startDate: IsoDate
  /** Пустая строка — повторять бессрочно. */
  endDate: string
  isActive: boolean
}

export type RecurringField = 'amount' | 'category' | 'account' | 'note' | 'interval' | 'startDate' | 'endDate'

interface ValidationContext {
  categories: readonly Category[]
  accounts: readonly Account[]
}

export function validateRecurringDraft(
  draft: RecurringDraft,
  { categories, accounts }: ValidationContext,
): ValidationResult<RecurringInput, RecurringField> {
  const errors: Partial<Record<RecurringField, string>> = {}

  const parsed = Money.parse(draft.amountText)
  if (!parsed.ok) errors.amount = PARSE_ERROR_MESSAGES[parsed.error]
  else if (parsed.value === 0) errors.amount = PARSE_ERROR_MESSAGES.empty

  const category = categories.find((item) => item.id === draft.categoryId)
  if (!category || category.type !== draft.type) errors.category = 'Выберите категорию'

  const account = accounts.find((item) => item.id === draft.accountId)
  if (!account) errors.account = 'Выберите счёт'

  const interval = Number(draft.intervalText)
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
    errors.interval = `Повтор от 1 до ${MAX_INTERVAL}`
  }

  if (!isValidIsoDate(draft.startDate)) errors.startDate = 'Укажите дату начала'

  const endDate = draft.endDate.trim()
  if (endDate !== '') {
    if (!isValidIsoDate(endDate)) errors.endDate = 'Укажите дату окончания'
    else if (endDate < draft.startDate) errors.endDate = 'Окончание раньше начала'
  }

  const note = draft.note.trim()
  if (note.length > RECURRING_NOTE_MAX_LENGTH) errors.note = `Не длиннее ${RECURRING_NOTE_MAX_LENGTH} символов`

  if (Object.keys(errors).length > 0 || !parsed.ok || !category || !account) return { ok: false, errors }

  return {
    ok: true,
    value: {
      type: draft.type,
      amount: parsed.value,
      categoryId: category.id,
      accountId: account.id,
      note,
      frequency: draft.frequency,
      interval,
      startDate: draft.startDate,
      // Поле необязательное: пустую строку в базу не пишем
      ...(endDate === '' ? {} : { endDate }),
      isActive: draft.isActive,
    },
  }
}

export function draftFromRecurring(recurring: RecurringTransaction): RecurringDraft {
  return {
    type: recurring.type,
    amountText: Money.toInputString(recurring.amount),
    categoryId: recurring.categoryId,
    accountId: recurring.accountId,
    note: recurring.note,
    frequency: recurring.frequency,
    intervalText: String(recurring.interval),
    startDate: recurring.startDate,
    endDate: recurring.endDate ?? '',
    isActive: recurring.isActive,
  }
}

export function emptyRecurringDraft(accountId: Id | null, today: IsoDate): RecurringDraft {
  return {
    type: 'expense',
    amountText: '',
    categoryId: null,
    accountId,
    note: '',
    frequency: 'monthly',
    intervalText: '1',
    startDate: today,
    endDate: '',
    isActive: true,
  }
}
