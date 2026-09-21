import type { CurrencyCode, MinorUnits } from '../types/entities'

const MINOR_PER_MAJOR = 100

/** 999 999 999,99 — с запасом влезает в Number.MAX_SAFE_INTEGER. */
export const MAX_AMOUNT: MinorUnits = 99_999_999_999

const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  UAH: '₴',
  USD: '$',
  EUR: '€',
  PLN: 'zł',
}

const NBSP = '\u00A0'
const MINUS = '\u2212'

export type SignDisplay =
  /** Минус только у отрицательных. */
  | 'auto'
  /** «+» у положительных, «−» у отрицательных, у нуля знака нет. */
  | 'always'
  /** Без знака (модуль). */
  | 'never'

export interface FormatOptions {
  sign?: SignDisplay
  /** Показывать символ валюты. По умолчанию true. */
  symbol?: boolean
}

export type ParseError = 'empty' | 'invalid' | 'tooLarge'

export const PARSE_ERROR_MESSAGES: Record<ParseError, string> = {
  empty: 'Введите сумму',
  invalid: 'Неверный формат суммы',
  tooLarge: 'Слишком большая сумма',
}
export type ParseResult = { ok: true; value: MinorUnits } | { ok: false; error: ParseError }

function assertSafe(value: number): MinorUnits {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money: значение ${value} не является безопасным целым`)
  }
  return value
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/**
 * Разбирает ввод пользователя: «125», «125,5», «125.50», «1 250,00».
 * Отрицательные значения не принимаются — знак задаётся типом операции.
 */
function parse(input: string): ParseResult {
  const normalized = input.replace(/[\s\u00A0\u202F]/g, '')
  if (normalized === '') return { ok: false, error: 'empty' }

  const match = /^(\d+)(?:[.,](\d{0,2}))?$/.exec(normalized)
  if (!match) return { ok: false, error: 'invalid' }

  const majorDigits = match[1].replace(/^0+(?=\d)/, '')
  if (majorDigits.length > 9) return { ok: false, error: 'tooLarge' }

  const fraction = (match[2] ?? '').padEnd(2, '0')
  const value = Number(majorDigits) * MINOR_PER_MAJOR + Number(fraction)

  if (value > MAX_AMOUNT) return { ok: false, error: 'tooLarge' }
  return { ok: true, value }
}

/** 125050 → «1 250,50 ₴», 125000 → «1 250 ₴». */
function format(amount: MinorUnits, currency: CurrencyCode, options: FormatOptions = {}): string {
  const { sign = 'auto', symbol = true } = options
  const safe = assertSafe(amount)
  const abs = Math.abs(safe)
  const major = Math.floor(abs / MINOR_PER_MAJOR)
  const minor = abs % MINOR_PER_MAJOR

  let text = groupThousands(String(major))
  if (minor !== 0) text += `,${String(minor).padStart(2, '0')}`
  if (symbol) text += `${NBSP}${CURRENCY_SYMBOLS[currency]}`

  if (sign === 'never' || safe === 0) return text
  if (safe < 0) return `${MINUS}${text}`
  return sign === 'always' ? `+${text}` : text
}

/**
 * Очищает текст поля суммы на лету: только цифры и одна запятая,
 * не больше 2 знаков после запятой и 9 до неё. «.» превращается в «,».
 */
function sanitizeInput(raw: string): string {
  const cleaned = raw.replace(/\./g, ',').replace(/[^\d,]/g, '')
  const commaIndex = cleaned.indexOf(',')
  const integerRaw = commaIndex === -1 ? cleaned : cleaned.slice(0, commaIndex)
  const fraction = commaIndex === -1 ? null : cleaned.slice(commaIndex + 1).replace(/,/g, '').slice(0, 2)

  let integer = integerRaw.replace(/^0+(?=\d)/, '').slice(0, 9)
  if (integer === '' && fraction !== null) integer = '0'

  return fraction === null ? integer : `${integer},${fraction}`
}

/**
 * Компактно, без копеек и символа валюты — для ячеек календаря,
 * где на сумму приходится около сорока пикселей.
 * 43000 → «430», 250000 → «2 500», 3200000 → «32к».
 */
function formatCompact(amount: MinorUnits): string {
  const major = Math.round(Math.abs(assertSafe(amount)) / MINOR_PER_MAJOR)
  if (major < 10_000) return groupThousands(String(major))
  return `${groupThousands(String(Math.round(major / 1000)))}к`
}

/** Для ввода/редактирования: 12550 → «125,50», 12500 → «125». */
function toInputString(amount: MinorUnits): string {
  const abs = Math.abs(assertSafe(amount))
  const major = Math.floor(abs / MINOR_PER_MAJOR)
  const minor = abs % MINOR_PER_MAJOR
  return minor === 0 ? String(major) : `${major},${String(minor).padStart(2, '0')}`
}

/** Только для целых значений в основных единицах (моки, дефолты): 430 → 43000. */
function fromMajor(major: number): MinorUnits {
  if (!Number.isInteger(major)) throw new RangeError('Money.fromMajor: ожидается целое число')
  return assertSafe(major * MINOR_PER_MAJOR)
}

function add(a: MinorUnits, b: MinorUnits): MinorUnits {
  return assertSafe(a + b)
}

function subtract(a: MinorUnits, b: MinorUnits): MinorUnits {
  return assertSafe(a - b)
}

function sum(values: Iterable<MinorUnits>): MinorUnits {
  let total = 0
  for (const value of values) total = add(total, value)
  return total
}

/** Доля part от total в процентах, округлённая до целого. 0, если total = 0. */
function percentOf(part: MinorUnits, total: MinorUnits): number {
  if (total === 0) return 0
  return Math.round((part * 100) / total)
}

function isValidAmount(value: unknown): value is MinorUnits {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT
}

function currencySymbol(currency: CurrencyCode): string {
  return CURRENCY_SYMBOLS[currency]
}

export const Money = {
  parse,
  sanitizeInput,
  format,
  formatCompact,
  toInputString,
  fromMajor,
  add,
  subtract,
  sum,
  percentOf,
  isValidAmount,
  currencySymbol,
} as const
