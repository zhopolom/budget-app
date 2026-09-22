import { describe, expect, it } from 'vitest'
import type { Category } from '../../types/entities'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { compileRules } from '../rules/matching'
import { guessMapping, isMappingComplete, type ColumnMapping } from './mapping'
import { assignCategory, buildImportRows, setInclude, summarizeRows } from './session'

const CATEGORIES: Category[] = [
  { id: C.groceries, name: 'Продукты', icon: '🛒', type: 'expense', isSystem: true, createdAt: 1 },
  { id: C.subscriptions, name: 'Подписки', icon: '🔁', type: 'expense', isSystem: true, createdAt: 2 },
  { id: C.salary, name: 'Зарплата', icon: '💰', type: 'income', isSystem: true, createdAt: 3 },
]

const RULES = compileRules([
  { id: 'rule-spotify', name: 'Spotify', enabled: true, matchType: 'contains', pattern: 'spotify', categoryId: C.subscriptions, priority: 10, createdAt: 1, updatedAt: 1 },
  { id: 'rule-salary', name: 'Зарплата', enabled: true, matchType: 'contains', pattern: 'зарплата', categoryId: C.salary, priority: 10, createdAt: 2, updatedAt: 2 },
])

const SIGNED: ColumnMapping = {
  date: 0,
  description: 1,
  amountMode: 'signed',
  amount: 2,
  debit: null,
  credit: null,
  type: null,
  category: null,
  dateFormat: 'DD.MM.YYYY',
  invertSign: false,
}

const build = (records: string[][], mapping: ColumnMapping = SIGNED, existing = new Set<string>()) =>
  buildImportRows(records, { accountId: 'acc-card', mapping, rules: RULES, categories: CATEGORIES, existingFingerprints: existing })

describe('buildImportRows', () => {
  it('одна колонка со знаком: минус — расход, плюс — доход, правила подставляют категорию', () => {
    const rows = build([
      ['21.09.2026', 'SPOTIFY Premium', '-199,00'],
      ['22.09.2026', 'Зарплата за сентябрь', '32 000,00'],
      ['23.09.2026', 'АТБ', '-430'],
    ])

    expect(rows[0]).toMatchObject({ status: 'ready', date: '2026-09-21', amount: 19_900, type: 'expense', categoryId: C.subscriptions, ruleId: 'rule-spotify', include: true })
    expect(rows[1]).toMatchObject({ status: 'ready', amount: 3_200_000, type: 'income', categoryId: C.salary })
    expect(rows[2]).toMatchObject({ status: 'needsCategory', amount: 43_000, type: 'expense', categoryId: null, include: true })
  })

  it('списание и зачисление в двух колонках', () => {
    const mapping: ColumnMapping = { ...SIGNED, amountMode: 'debitCredit', amount: null, debit: 2, credit: 3 }
    const rows = build(
      [
        ['21.09.2026', 'АТБ', '430,00', ''],
        ['22.09.2026', 'Зарплата', '', '32000'],
        ['23.09.2026', 'Оба', '1', '2'],
        ['24.09.2026', 'Пусто', '', ''],
      ],
      mapping,
    )
    expect(rows[0]).toMatchObject({ type: 'expense', amount: 43_000 })
    expect(rows[1]).toMatchObject({ type: 'income', amount: 3_200_000, categoryId: C.salary })
    expect(rows[2]).toMatchObject({ status: 'error', error: 'Заполнены и списание, и зачисление', include: false })
    expect(rows[3]).toMatchObject({ status: 'error', error: 'Нет суммы' })
  })

  it('колонка «Тип» важнее знака, а перевёрнутый знак — для выгрузок с положительными расходами', () => {
    const withType: ColumnMapping = { ...SIGNED, type: 3 }
    const rows = build([['21.09.2026', 'Возврат', '199', 'Расход']], withType)
    expect(rows[0]).toMatchObject({ type: 'expense', amount: 19_900 })

    const inverted = build([['21.09.2026', 'АТБ', '430']], { ...SIGNED, invertSign: true })
    expect(inverted[0].type).toBe('expense')
  })

  it('категория из колонки CSV — по названию и только своего типа', () => {
    const withCategory: ColumnMapping = { ...SIGNED, category: 3 }
    const rows = build(
      [
        ['21.09.2026', 'АТБ', '-430', 'продукты'],
        ['22.09.2026', 'АТБ', '-430', 'Зарплата'],
      ],
      withCategory,
    )
    expect(rows[0].categoryId).toBe(C.groceries)
    // «Зарплата» — категория дохода, расходу не подходит
    expect(rows[1].status).toBe('needsCategory')
  })

  it('правило на категорию другого типа не применяется', () => {
    const rows = build([['21.09.2026', 'Зарплата', '-100']])
    expect(rows[0]).toMatchObject({ status: 'needsCategory', type: 'expense', categoryId: null })
  })

  it('ошибки даты и суммы не импортируются, но строка остаётся в превью', () => {
    const rows = build([
      ['31.02.2026', 'АТБ', '-430'],
      ['21.09.2026', 'АТБ', 'abc'],
      ['21.09.2026', 'АТБ', '0'],
      ['21.09.2026', 'АТБ', ''],
    ])
    expect(rows.map((row) => row.error)).toEqual(['Не читается дата', 'Не читается сумма', 'Нулевая сумма', 'Нет суммы'])
    expect(rows.every((row) => row.status === 'error' && !row.include)).toBe(true)
  })

  it('дубли: против базы и внутри файла, по умолчанию не включены', () => {
    const first = build([['21.09.2026', 'SPOTIFY', '-199']])
    const existing = new Set([first[0].fingerprint!])

    const rows = build(
      [
        ['21.09.2026', 'spotify', '-199,00'],
        ['22.09.2026', 'АТБ', '-430'],
        ['22.09.2026', 'АТБ ', '-430.00'],
      ],
      SIGNED,
      existing,
    )
    expect(rows[0]).toMatchObject({ status: 'duplicate', duplicateOf: 'existing', include: false })
    expect(rows[1].status).toBe('needsCategory')
    expect(rows[2]).toMatchObject({ status: 'duplicate', duplicateOf: 'file', include: false })
  })
})

describe('summarizeRows, assignCategory, setInclude', () => {
  it('сводка и решения пользователя', () => {
    const rows = build([
      ['21.09.2026', 'SPOTIFY', '-199'],
      ['22.09.2026', 'АТБ', '-430'],
      ['22.09.2026', 'АТБ', '-430'],
      ['x', 'АТБ', '-430'],
    ])
    expect(summarizeRows(rows)).toEqual({ total: 4, ready: 1, duplicates: 1, errors: 1, needsCategory: 1, toImport: 1 })

    const assigned = rows.map((row) => (row.status === 'needsCategory' ? assignCategory(row, C.groceries) : row))
    expect(assigned[1]).toMatchObject({ status: 'ready', categoryId: C.groceries })
    expect(summarizeRows(assigned).toImport).toBe(2)

    // Дубль импортируется всё равно — только после его категоризации и явного включения
    const forced = assigned.map((row) => (row.status === 'duplicate' ? setInclude(assignCategory(row, C.groceries), true) : row))
    expect(forced[2]).toMatchObject({ status: 'duplicate', include: true, categoryId: C.groceries })
    expect(summarizeRows(forced).toImport).toBe(3)

    // Ошибочную строку включить нельзя
    expect(setInclude(rows[3], true).include).toBe(false)
  })
})

describe('guessMapping', () => {
  it('по названиям колонок: дата, описание, сумма, формат даты', () => {
    const guess = guessMapping(['Дата операции', 'Описание', 'Сумма', 'Валюта'], [['21.09.2026', 'АТБ', '-430', 'UAH']])
    expect(guess.mapping).toMatchObject({ date: 0, description: 1, amount: 2, amountMode: 'signed', dateFormat: 'DD.MM.YYYY' })
    expect(isMappingComplete(guess.mapping)).toBe(true)
  })

  it('списание и зачисление узнаются по названиям', () => {
    const guess = guessMapping(['Date', 'Details', 'Debit', 'Credit'], [['2026-09-21', 'ATB', '430.00', '']])
    expect(guess.mapping).toMatchObject({ amountMode: 'debitCredit', debit: 2, credit: 3, amount: null })
  })

  it('неоднозначная дата остаётся на выбор пользователю', () => {
    const guess = guessMapping(['Date', 'Amount'], [['03/04/2026', '-1']])
    expect(guess.dateFormats).toEqual(['DD/MM/YYYY', 'MM/DD/YYYY'])
    expect(guess.mapping.dateFormat).toBeUndefined()
    expect(isMappingComplete(guess.mapping)).toBe(false)
  })

  it('без понятных заголовков колонки угадываются по содержимому', () => {
    const guess = guessMapping(['a', 'b', 'c'], [['21.09.2026', 'АТБ', '-430'], ['22.09.2026', 'Сільпо', '-120,50']])
    expect(guess.mapping).toMatchObject({ date: 0, amount: 2, dateFormat: 'DD.MM.YYYY' })
  })
})
