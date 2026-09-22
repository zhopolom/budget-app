import type {
  Account,
  Category,
  Id,
  IsoDate,
  ManualTransactionType,
  RecurrenceFrequency,
  RecurringTransaction,
} from '../../types/entities'
import type { ValidationResult } from '../../types/validation'
import { isValidIsoDate } from '../../utils/dates'
import { Money, PARSE_ERROR_MESSAGES } from '../../utils/money'
import { isRecurringTransfer } from './model'
import { MAX_RECURRING_INTERVAL } from './occurrences'
import type { RecurringInput } from './repository'

export const RECURRING_NOTE_MAX_LENGTH = 120
/** Граница общая с парсером копий — см. occurrences.ts. */
export const MAX_INTERVAL = MAX_RECURRING_INTERVAL

/**
 * Состояние формы. Поля всех трёх типов держим рядом, чтобы переключение
 * «Расход / Доход / Перевод» не стирало уже введённое — как в форме операции.
 *
 * Активности здесь нет: ею управляет кнопка «Отключить/Включить» рядом с формой,
 * а черновик снимается один раз при открытии шторки и о нажатии кнопки не узнает.
 */
export interface RecurringDraft {
  type: ManualTransactionType
  amountText: string
  categoryId: Id | null
  accountId: Id | null
  fromAccountId: Id | null
  toAccountId: Id | null
  note: string
  frequency: RecurrenceFrequency
  intervalText: string
  startDate: IsoDate
  /** Пустая строка — повторять бессрочно. */
  endDate: string
}

export type RecurringField =
  | 'amount'
  | 'category'
  | 'account'
  | 'fromAccount'
  | 'toAccount'
  | 'note'
  | 'interval'
  | 'startDate'
  | 'endDate'

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

  const schedule = {
    amount: parsed.ok ? parsed.value : 0,
    note,
    frequency: draft.frequency,
    interval,
    startDate: draft.startDate,
    // Поле необязательное: пустую строку в базу не пишем
    ...(endDate === '' ? {} : { endDate }),
  }

  const failed = (): ValidationResult<RecurringInput, RecurringField> => ({ ok: false, errors })

  if (draft.type === 'transfer') {
    const from = accounts.find((account) => account.id === draft.fromAccountId)
    const to = accounts.find((account) => account.id === draft.toAccountId)

    if (!from) errors.fromAccount = 'Выберите счёт'
    if (!to) errors.toAccount = 'Выберите счёт'
    if (from && to && from.id === to.id) errors.toAccount = 'Выберите другой счёт'
    if (from && to && from.currency !== to.currency) errors.toAccount = 'Счета в разных валютах'

    if (Object.keys(errors).length > 0 || !parsed.ok || !from || !to) return failed()
    return { ok: true, value: { type: 'transfer', fromAccountId: from.id, toAccountId: to.id, ...schedule } }
  }

  const category = categories.find((item) => item.id === draft.categoryId)
  if (!category || category.type !== draft.type) errors.category = 'Выберите категорию'

  const account = accounts.find((item) => item.id === draft.accountId)
  if (!account) errors.account = 'Выберите счёт'

  if (Object.keys(errors).length > 0 || !parsed.ok || !category || !account) return failed()
  return { ok: true, value: { type: draft.type, categoryId: category.id, accountId: account.id, ...schedule } }
}

export function draftFromRecurring(recurring: RecurringTransaction): RecurringDraft {
  const common = {
    amountText: Money.toInputString(recurring.amount),
    note: recurring.note,
    frequency: recurring.frequency,
    intervalText: String(recurring.interval),
    startDate: recurring.startDate,
    endDate: recurring.endDate ?? '',
  }

  if (isRecurringTransfer(recurring)) {
    return {
      type: 'transfer',
      categoryId: null,
      accountId: null,
      fromAccountId: recurring.fromAccountId,
      toAccountId: recurring.toAccountId,
      ...common,
    }
  }

  return {
    type: recurring.type,
    categoryId: recurring.categoryId,
    accountId: recurring.accountId,
    fromAccountId: null,
    toAccountId: null,
    ...common,
  }
}

export function emptyRecurringDraft(accountId: Id | null, today: IsoDate): RecurringDraft {
  return {
    type: 'expense',
    amountText: '',
    categoryId: null,
    accountId,
    fromAccountId: accountId,
    toAccountId: null,
    note: '',
    frequency: 'monthly',
    intervalText: '1',
    startDate: today,
    endDate: '',
  }
}
