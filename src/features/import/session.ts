import type { Category, EntryType, Id, IsoDate, MinorUnits } from '../../types/entities'
import { fingerprint } from './fingerprint'
import type { ColumnMapping } from './mapping'
import { normalizeDescription, parseAmount, parseDateWith } from './normalize'
import { pickRule, type CompiledRule } from '../rules/matching'

/**
 * Сессия импорта в памяти (ТЗ §50): разбор → нормализация → проверка →
 * дубли → правила → превью. До подтверждения в базу не пишется ничего;
 * строки несут статус и решение пользователя.
 */

export const IMPORT_LIMITS = {
  /** 5 МБ: банковская выгрузка за годы — сотни килобайт. */
  maxFileBytes: 5 * 1024 * 1024,
  maxRows: 20_000,
} as const

export type ImportRowStatus =
  /** Всё прочитано, категория есть. */
  | 'ready'
  /** Такая операция уже есть в базе или встретилась выше в файле. */
  | 'duplicate'
  /** Не читается дата или сумма — строка не импортируется. */
  | 'error'
  /** Прочитана, но категорию нужно выбрать. */
  | 'needsCategory'

export const IMPORT_STATUS_LABELS: Record<ImportRowStatus, string> = {
  ready: 'готово',
  duplicate: 'возможный дубль',
  error: 'ошибка',
  needsCategory: 'нужна категория',
}

export interface ImportRow {
  /** Номер строки в файле без заголовка, с единицы — чтобы человек нашёл её в таблице. */
  line: number
  raw: string[]
  status: ImportRowStatus
  error?: string
  date?: IsoDate
  amount?: MinorUnits
  type?: EntryType
  description: string
  categoryId: Id | null
  /** Правило, которое подставило категорию. */
  ruleId?: Id
  fingerprint?: string
  duplicateOf?: 'existing' | 'file'
  /** Решение: импортировать строку. У дублей и ошибок по умолчанию нет. */
  include: boolean
}

export interface BuildRowsOptions {
  accountId: Id
  mapping: ColumnMapping
  rules: readonly CompiledRule[]
  categories: readonly Category[]
  /** Отпечатки операций счёта, которые уже в базе. */
  existingFingerprints: ReadonlySet<string>
}

const INCOME_WORDS = ['доход', 'приход', 'зачисл', 'пополн', 'income', 'credit', 'deposit', 'inflow']
const EXPENSE_WORDS = ['расход', 'списан', 'оплат', 'покуп', 'expense', 'debit', 'withdraw', 'outflow', 'payment']

/** Тип из колонки «Тип», если она однозначна; иначе null и решает знак суммы. */
function typeFromColumn(value: string): EntryType | null {
  const normalized = normalizeDescription(value)
  if (normalized === '') return null
  if (INCOME_WORDS.some((word) => normalized.includes(word))) return 'income'
  if (EXPENSE_WORDS.some((word) => normalized.includes(word))) return 'expense'
  return null
}

interface ParsedAmount {
  amount: MinorUnits
  type: EntryType
}

function readAmount(raw: readonly string[], mapping: ColumnMapping): ParsedAmount | string {
  if (mapping.amountMode === 'debitCredit') {
    const debitText = (raw[mapping.debit ?? -1] ?? '').trim()
    const creditText = (raw[mapping.credit ?? -1] ?? '').trim()
    if (debitText === '' && creditText === '') return 'Нет суммы'
    const debit = debitText === '' ? null : parseAmount(debitText)
    const credit = creditText === '' ? null : parseAmount(creditText)
    if (debit && !debit.ok) return 'Не читается сумма списания'
    if (credit && !credit.ok) return 'Не читается сумма зачисления'
    const debitValue = debit?.ok ? Math.abs(debit.value) : 0
    const creditValue = credit?.ok ? Math.abs(credit.value) : 0
    if (debitValue > 0 && creditValue > 0) return 'Заполнены и списание, и зачисление'
    if (debitValue === 0 && creditValue === 0) return 'Нулевая сумма'
    return debitValue > 0 ? { amount: debitValue, type: 'expense' } : { amount: creditValue, type: 'income' }
  }

  const parsed = parseAmount(raw[mapping.amount ?? -1] ?? '')
  if (!parsed.ok) return parsed.reason === 'empty' ? 'Нет суммы' : parsed.reason === 'tooLarge' ? 'Слишком большая сумма' : 'Не читается сумма'
  if (parsed.value === 0) return 'Нулевая сумма'
  const negative = mapping.invertSign ? parsed.value > 0 : parsed.value < 0
  return { amount: Math.abs(parsed.value), type: negative ? 'expense' : 'income' }
}

/** Категория по названию из колонки CSV — только того же типа, что и операция. */
function categoryByName(name: string, type: EntryType, categories: readonly Category[]): Category | undefined {
  const normalized = normalizeDescription(name)
  if (normalized === '') return undefined
  return categories.find((category) => category.type === type && normalizeDescription(category.name) === normalized)
}

export function buildImportRows(records: readonly string[][], options: BuildRowsOptions): ImportRow[] {
  const { accountId, mapping, rules, categories, existingFingerprints } = options
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const seen = new Set<string>()

  return records.map((raw, index) => {
    const description = (mapping.description === null ? '' : (raw[mapping.description] ?? '')).replace(/\s+/g, ' ').trim()
    const base = { line: index + 1, raw, description }

    const date = parseDateWith(raw[mapping.date] ?? '', mapping.dateFormat)
    if (!date) return { ...base, status: 'error', error: 'Не читается дата', categoryId: null, include: false }

    const money = readAmount(raw, mapping)
    if (typeof money === 'string') return { ...base, status: 'error', error: money, categoryId: null, include: false }

    // Колонка «Тип» важнее знака: у некоторых выгрузок все суммы положительные
    const explicitType = mapping.type === null ? null : typeFromColumn(raw[mapping.type] ?? '')
    const type = explicitType ?? money.type

    let categoryId: Id | null = null
    let ruleId: Id | undefined
    const named = mapping.category === null ? undefined : categoryByName(raw[mapping.category] ?? '', type, categories)
    if (named) {
      categoryId = named.id
    } else {
      const rule = pickRule(rules, description, accountId)
      // Правило на категорию другого типа к этой строке не относится
      if (rule && categoryById.get(rule.categoryId)?.type === type) {
        categoryId = rule.categoryId
        ruleId = rule.id
      }
    }

    const print = fingerprint({ date, amount: money.amount, type, accountId, description })
    const duplicateOf = existingFingerprints.has(print) ? 'existing' : seen.has(print) ? 'file' : undefined
    seen.add(print)

    const row: ImportRow = {
      ...base,
      status: duplicateOf ? 'duplicate' : categoryId ? 'ready' : 'needsCategory',
      date,
      amount: money.amount,
      type,
      categoryId,
      ...(ruleId ? { ruleId } : {}),
      fingerprint: print,
      ...(duplicateOf ? { duplicateOf } : {}),
      include: !duplicateOf,
    }
    return row
  })
}

export interface ImportSummary {
  total: number
  ready: number
  duplicates: number
  errors: number
  needsCategory: number
  /** Сколько строк будет записано: включённые, с датой, суммой и категорией. */
  toImport: number
}

/** Строка готова к записи: включена, прочитана и с категорией. */
export function isImportable(row: ImportRow): boolean {
  return row.include && row.status !== 'error' && row.categoryId !== null && row.date !== undefined && row.amount !== undefined
}

export function summarizeRows(rows: readonly ImportRow[]): ImportSummary {
  const summary: ImportSummary = { total: rows.length, ready: 0, duplicates: 0, errors: 0, needsCategory: 0, toImport: 0 }
  for (const row of rows) {
    if (row.status === 'ready') summary.ready += 1
    else if (row.status === 'duplicate') summary.duplicates += 1
    else if (row.status === 'error') summary.errors += 1
    else summary.needsCategory += 1
    if (isImportable(row)) summary.toImport += 1
  }
  return summary
}

/** Пользователь выбрал категорию строке (или всем без категории): статус пересчитывается. */
export function assignCategory(row: ImportRow, categoryId: Id | null): ImportRow {
  if (row.status === 'error') return row
  const next: ImportRow = { ...row, categoryId }
  delete next.ruleId
  if (row.status !== 'duplicate') next.status = categoryId ? 'ready' : 'needsCategory'
  return next
}

export function setInclude(row: ImportRow, include: boolean): ImportRow {
  if (row.status === 'error') return row
  return { ...row, include }
}
