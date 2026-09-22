import { detectDateFormats, normalizeDescription, parseAmount, type DateFormat } from './normalize'

/**
 * Сопоставление колонок CSV (ТЗ §46). Два способа задать сумму: одна колонка
 * со знаком или две — списание и зачисление. Тип и категория необязательны.
 */

export type AmountMode = 'signed' | 'debitCredit'

export interface ColumnMapping {
  /** Индексы колонок; null — колонка не используется. */
  date: number
  description: number | null
  amountMode: AmountMode
  amount: number | null
  debit: number | null
  credit: number | null
  type: number | null
  category: number | null
  dateFormat: DateFormat
  /** У некоторых выгрузок расход положительный: перевернуть знак. */
  invertSign: boolean
}

export interface MappingGuess {
  mapping: Partial<ColumnMapping>
  /** Форматы даты, подходящие ко всем строкам колонки даты: один — известен, несколько — спросить. */
  dateFormats: DateFormat[]
}

const DATE_NAMES = ['дата', 'date', 'дата операции', 'дата и время', 'transaction date', 'posted']
const AMOUNT_NAMES = ['сумма', 'amount', 'сумма операции', 'сумма в валюте счета', 'total', 'value']
const DEBIT_NAMES = ['расход', 'списание', 'дебет', 'debit', 'withdrawal', 'outflow', 'expense']
const CREDIT_NAMES = ['приход', 'зачисление', 'кредит', 'credit', 'deposit', 'inflow', 'income']
const DESCRIPTION_NAMES = ['описание', 'назначение', 'назначение платежа', 'комментарий', 'description', 'details', 'note', 'memo', 'merchant', 'контрагент', 'payee']
const TYPE_NAMES = ['тип', 'type', 'вид операции', 'transaction type']
const CATEGORY_NAMES = ['категория', 'category']

function findColumn(header: readonly string[], names: readonly string[], taken: ReadonlySet<number>): number | null {
  const normalized = header.map((cell) => normalizeDescription(cell))
  // Сначала точное совпадение, потом вхождение: «Дата операции» важнее «дата валютирования»
  for (const name of names) {
    const exact = normalized.findIndex((cell, index) => cell === name && !taken.has(index))
    if (exact !== -1) return exact
  }
  for (const name of names) {
    const partial = normalized.findIndex((cell, index) => cell.includes(name) && !taken.has(index))
    if (partial !== -1) return partial
  }
  return null
}

const column = (records: readonly string[][], index: number, limit = 200) =>
  records.slice(0, limit).map((row) => row[index] ?? '')

/** Колонка, в которой хотя бы половина непустых значений читается как сумма. */
function looksLikeAmount(values: readonly string[]): boolean {
  const filled = values.filter((value) => value.trim() !== '')
  if (filled.length === 0) return false
  return filled.filter((value) => parseAmount(value).ok).length * 2 >= filled.length
}

/**
 * Догадка по названиям колонок и по содержимому. Это только начальное
 * значение формы: пользователь видит и подтверждает каждое поле.
 */
export function guessMapping(header: readonly string[], records: readonly string[][]): MappingGuess {
  const taken = new Set<number>()
  const take = (index: number | null) => {
    if (index !== null) taken.add(index)
    return index
  }

  let date = take(findColumn(header, DATE_NAMES, taken))
  if (date === null) {
    // По содержимому: первая колонка, где все значения — даты одного формата
    date = header.findIndex((_, index) => !taken.has(index) && detectDateFormats(column(records, index)).length > 0)
    if (date === -1) date = null
    else taken.add(date)
  }

  const debit = take(findColumn(header, DEBIT_NAMES, taken))
  const credit = take(findColumn(header, CREDIT_NAMES, taken))
  let amount: number | null = null
  let amountMode: AmountMode = 'signed'
  if (debit !== null && credit !== null) {
    amountMode = 'debitCredit'
  } else {
    amount = take(findColumn(header, AMOUNT_NAMES, taken))
    if (amount === null) {
      amount = header.findIndex((_, index) => !taken.has(index) && looksLikeAmount(column(records, index)))
      if (amount === -1) amount = null
      else taken.add(amount)
    }
  }

  const description = take(findColumn(header, DESCRIPTION_NAMES, taken))
  const type = take(findColumn(header, TYPE_NAMES, taken))
  const category = take(findColumn(header, CATEGORY_NAMES, taken))
  const dateFormats = date === null ? [] : detectDateFormats(column(records, date, 5_000))

  return {
    mapping: {
      ...(date === null ? {} : { date }),
      description,
      amountMode,
      amount,
      debit: amountMode === 'debitCredit' ? debit : null,
      credit: amountMode === 'debitCredit' ? credit : null,
      type,
      category,
      ...(dateFormats.length === 1 ? { dateFormat: dateFormats[0] } : {}),
      invertSign: false,
    },
    dateFormats,
  }
}

/** Сопоставление полное, когда есть дата, формат даты и способ прочитать сумму. */
export function isMappingComplete(mapping: Partial<ColumnMapping>): mapping is ColumnMapping {
  if (mapping.date === undefined || mapping.dateFormat === undefined || mapping.amountMode === undefined) return false
  if (mapping.amountMode === 'signed') return typeof mapping.amount === 'number'
  return typeof mapping.debit === 'number' && typeof mapping.credit === 'number'
}
