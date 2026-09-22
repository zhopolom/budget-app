import { db } from '../db/database'
import { DEFAULT_ACCOUNT_IDS } from '../features/accounts/defaults'
import { buildMonthAnalytics } from '../features/analytics/service'
import { createBackup, serializeBackup } from '../features/backup/repository'
import { toCsv } from '../features/backup/csv'
import { SYSTEM_CATEGORY_IDS as C } from '../features/categories/defaults'
import { calculateForecast, listUpcoming, UPCOMING_DAYS } from '../features/forecast/service'
import { parseCsvFile } from '../features/import/csv'
import { loadExistingFingerprints } from '../features/import/repository'
import { buildImportRows } from '../features/import/session'
import { compileRules, pickRule } from '../features/rules/matching'
import {
  calculateAccountActivity,
  calculateAccountBalances,
  calculateCategoryTotals,
  calculateTotalBalance,
  calculateTotals,
} from '../features/transactions/calculations'
import { applyFilters, EMPTY_FILTERS } from '../features/transactions/filters'
import { accountIdsOf } from '../features/transactions/model'
import { toTransactionViews } from '../features/transactions/views'
import type { CategoryRule, RecurringTransaction, Transaction } from '../types/entities'
import { addDaysIso, monthDateRange, toIsoDate, toYearMonth } from '../utils/dates'
import { Money } from '../utils/money'

/**
 * Замер скорости расчётов на большой истории операций.
 *
 * Не оптимизация, а линейка: прежде чем усложнять код кэшами, нужно знать,
 * где он действительно медленный. Данные детерминированные — прогоны
 * сравнимы между собой. Запуск: npm run bench.
 */

export interface BenchmarkResult {
  size: number
  /** Название измерения → медиана трёх прогонов, мс. */
  timings: Record<string, number>
}

const EXPENSE_CATEGORIES = [C.groceries, C.transport, C.cafe, C.entertainment, C.subscriptions, C.shopping]
const NOTES = ['АТБ', 'Сільпо', 'Uber', 'Spotify', 'Кофе с собой', 'Аптека', '', 'Кино', 'Rozetka', 'Bolt']

/** Простой детерминированный генератор: одинаковые данные при каждом запуске. */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

/** N операций за последние ~3 года: расходы, доходы раз в месяц, немного переводов. */
export function generateTransactions(count: number, today = new Date(2026, 8, 22)): Transaction[] {
  const random = lcg(count)
  const dayMs = 86_400_000
  const rows: Transaction[] = []

  for (let index = 0; index < count; index += 1) {
    const daysAgo = Math.floor(random() * 1_095)
    const date = toIsoDate(new Date(today.getTime() - daysAgo * dayMs))
    const createdAt = today.getTime() - daysAgo * dayMs + Math.floor(random() * dayMs)
    const roll = random()

    if (roll < 0.04) {
      rows.push({
        id: `bench-${index}`,
        type: 'transfer',
        amount: Money.fromMajor(100 + Math.floor(random() * 50) * 100),
        fromAccountId: DEFAULT_ACCOUNT_IDS.card,
        toAccountId: DEFAULT_ACCOUNT_IDS.cash,
        date,
        note: 'Снял в банкомате',
        createdAt,
        updatedAt: createdAt,
      })
    } else if (roll < 0.1) {
      rows.push({
        id: `bench-${index}`,
        type: 'income',
        amount: Money.fromMajor(10_000 + Math.floor(random() * 40) * 1_000),
        categoryId: C.salary,
        accountId: DEFAULT_ACCOUNT_IDS.card,
        date,
        note: '',
        createdAt,
        updatedAt: createdAt,
      })
    } else {
      rows.push({
        id: `bench-${index}`,
        type: 'expense',
        amount: 100 + Math.floor(random() * 300_000),
        categoryId: EXPENSE_CATEGORIES[Math.floor(random() * EXPENSE_CATEGORIES.length)],
        accountId: random() < 0.7 ? DEFAULT_ACCOUNT_IDS.card : DEFAULT_ACCOUNT_IDS.cash,
        date,
        note: NOTES[Math.floor(random() * NOTES.length)],
        createdAt,
        updatedAt: createdAt,
      })
    }
  }

  return rows
}

/** Расписания для прогноза: ежедневное, еженедельное, три ежемесячных — обычный набор. */
function generateRules(today: string): RecurringTransaction[] {
  const base = {
    accountId: DEFAULT_ACCOUNT_IDS.card,
    interval: 1,
    startDate: '2026-01-01',
    nextOccurrence: today,
    isActive: true,
    executionMode: 'automatic' as const,
    createdAt: 1,
    updatedAt: 1,
  }
  return [
    { ...base, id: 'bench-rule-daily', type: 'expense', amount: Money.fromMajor(100), categoryId: C.transport, note: 'Проездной', frequency: 'daily' },
    { ...base, id: 'bench-rule-weekly', type: 'expense', amount: Money.fromMajor(800), categoryId: C.groceries, note: '', frequency: 'weekly' },
    { ...base, id: 'bench-rule-rent', type: 'expense', amount: Money.fromMajor(12_000), categoryId: C.home, note: 'Аренда', frequency: 'monthly' },
    { ...base, id: 'bench-rule-spotify', type: 'expense', amount: Money.fromMajor(199), categoryId: C.subscriptions, note: 'Spotify', frequency: 'monthly' },
    { ...base, id: 'bench-rule-salary', type: 'income', amount: Money.fromMajor(32_000), categoryId: C.salary, note: '', frequency: 'monthly' },
  ]
}

/** Двадцать правил категорий — больше, чем заведёт обычный пользователь. */
function generateCategoryRules(): CategoryRule[] {
  const patterns = ['атб', 'сільпо', 'uber', 'spotify', 'кофе', 'аптека', 'кино', 'rozetka', 'bolt', 'netflix', 'novus', 'wog', 'okko', 'glovo', 'monobank', 'apple', 'google', 'steam', 'ikea', 'zara']
  return patterns.map((pattern, index) => ({
    id: `bench-rule-${index}`,
    name: pattern,
    enabled: true,
    matchType: index % 3 === 0 ? 'startsWith' : 'contains',
    pattern,
    categoryId: EXPENSE_CATEGORIES[index % EXPENSE_CATEGORIES.length],
    priority: index,
    createdAt: index,
    updatedAt: index,
  }))
}

/** CSV на count строк в формате банковской выгрузки: дата; описание; сумма. */
function generateCsv(count: number): string {
  const random = lcg(count + 7)
  const lines = ['Дата;Описание;Сумма']
  for (let index = 0; index < count; index += 1) {
    const day = 1 + Math.floor(random() * 28)
    const month = 1 + Math.floor(random() * 12)
    const note = NOTES[Math.floor(random() * NOTES.length)] || 'Покупка'
    const amount = (100 + Math.floor(random() * 300_000)) / 100
    lines.push(`${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.2026;${note} ${index};-${amount.toFixed(2).replace('.', ',')}`)
  }
  return lines.join('\r\n')
}

async function median(run: () => Promise<unknown> | unknown, runs = 3): Promise<number> {
  const samples: number[] = []
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now()
    await run()
    samples.push(performance.now() - started)
  }
  samples.sort((a, b) => a - b)
  return Math.round(samples[Math.floor(samples.length / 2)] * 10) / 10
}

/**
 * Прогоняет расчёты каждого экрана на базе с count операциями.
 * База должна быть открыта и пуста (кроме счетов и категорий по умолчанию).
 */
export async function runBenchmark(count: number, today = new Date(2026, 8, 22)): Promise<BenchmarkResult> {
  const rows = generateTransactions(count, today)
  const month = toYearMonth(today)
  const { start, end } = monthDateRange(month)
  const todayIso = toIsoDate(today)

  await db.transactions.clear()
  const timings: Record<string, number> = {}

  timings['запись в базу (bulkAdd)'] = await median(() => db.transactions.bulkAdd(rows), 1)

  const [accounts, categories] = await Promise.all([db.accounts.toArray(), db.categories.toArray()])

  // Главная: общий баланс по всей истории + итоги месяца + расходы по категориям
  timings['главная'] = await median(async () => {
    const all = await db.transactions.toArray()
    const ofMonth = await db.transactions.where('date').between(start, end, true, true).toArray()
    calculateTotalBalance(accounts, all)
    calculateTotals(ofMonth)
    calculateCategoryTotals(ofMonth)
  })

  // Счета: остатки всех счетов и число операций по каждому
  timings['счета'] = await median(async () => {
    const all = await db.transactions.toArray()
    calculateAccountBalances(accounts, all)
    const counts = new Map<string, number>()
    for (const transaction of all) {
      for (const accountId of new Set(accountIdsOf(transaction))) counts.set(accountId, (counts.get(accountId) ?? 0) + 1)
    }
  })

  // Карточка счёта: обороты за месяц по одному счёту
  timings['карточка счёта'] = await median(async () => {
    const ofMonth = await db.transactions.where('date').between(start, end, true, true).toArray()
    calculateAccountActivity(DEFAULT_ACCOUNT_IDS.card, ofMonth)
  })

  // Статистика месяца
  timings['статистика'] = await median(async () => {
    const ofMonth = await db.transactions.where('date').between(start, end, true, true).toArray()
    buildMonthAnalytics({
      month,
      today: todayIso,
      views: toTransactionViews(ofMonth, categories, accounts),
      previousExpense: 0,
      categories,
    })
  })

  // Поиск по всей истории — так работает экран «Операции» с периодом «всё время»
  const allViews = toTransactionViews(rows, categories, accounts)
  timings['поиск по всей истории'] = await median(() =>
    applyFilters(allViews, { ...EMPTY_FILTERS, period: 'all' }, 'атб'),
  )

  timings['CSV'] = await median(() => toCsv(allViews, 'UAH'))

  // Прогноз и ближайшие операции: баланс по всей истории + вхождения расписаний до конца месяца
  const rules = generateRules(todayIso)
  timings['прогноз'] = await median(async () => {
    const all = await db.transactions.toArray()
    calculateForecast({ today: todayIso, accounts, transactions: all, rules, monthlyLimit: Money.fromMajor(30_000) })
    listUpcoming(rules, todayIso, addDaysIso(todayIso, UPCOMING_DAYS), 5)
  })

  timings['резервная копия'] = await median(async () => serializeBackup(await createBackup(today, 'bench')))

  // Правила категорий: 20 правил против описаний всей истории — как при превью правила
  const compiled = compileRules(generateCategoryRules())
  timings['правила × история'] = await median(() => {
    for (const transaction of rows) if (transaction.type !== 'transfer') pickRule(compiled, transaction.note, DEFAULT_ACCOUNT_IDS.card)
  })

  // Импорт CSV: разбор файла на 5 000 строк, отпечатки всей истории счёта, сборка превью.
  // Файл одного размера для всех прогонов: растёт только история, против которой ищутся дубли
  const csv = generateCsv(5_000)
  timings['импорт CSV (5 000 строк)'] = await median(async () => {
    const parsed = parseCsvFile(csv)
    const existing = await loadExistingFingerprints(DEFAULT_ACCOUNT_IDS.card)
    buildImportRows(parsed.records, {
      accountId: DEFAULT_ACCOUNT_IDS.card,
      mapping: { date: 0, description: 1, amountMode: 'signed', amount: 2, debit: null, credit: null, type: null, category: null, dateFormat: 'DD.MM.YYYY', invertSign: false },
      rules: compiled,
      categories,
      existingFingerprints: existing,
    })
  })

  return { size: count, timings }
}

export function formatBenchmark(results: readonly BenchmarkResult[]): string {
  if (results.length === 0) return ''
  const names = Object.keys(results[0].timings)
  const header = ['операций', ...results.map((result) => String(result.size))]
  const lines = names.map((name) => [name, ...results.map((result) => `${result.timings[name]} мс`)])
  const widths = header.map((_, column) => Math.max(header[column].length, ...lines.map((line) => line[column].length)))
  const row = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ')
  return [row(header), ...lines.map(row)].join('\n')
}
