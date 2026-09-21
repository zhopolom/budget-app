import { subDays } from 'date-fns'
import { db } from '../db/database'
import { DEFAULT_ACCOUNT_IDS } from '../features/accounts/defaults'
import { budgetIdFor, categoryBudgetIdFor } from '../features/budgets/ids'
import { SYSTEM_CATEGORY_IDS as C } from '../features/categories/defaults'
import type { CategoryBudget, EntryType, Transaction } from '../types/entities'
import { toIsoDate, toYearMonth, type YearMonth } from '../utils/dates'
import { createId } from '../utils/id'
import { Money } from '../utils/money'

type MockRow = [type: EntryType, amount: number, categoryId: string, note: string, daysAgo: number, cash?: boolean]

const CURRENT_MONTH: MockRow[] = [
  ['income', 32_000, C.salary, '', 20],
  ['expense', 430, C.groceries, 'АТБ', 0],
  ['expense', 180, C.transport, 'Такси', 0],
  ['expense', 199, C.subscriptions, 'Spotify', 1],
  ['expense', 220, C.cafe, 'Кофе с собой', 1, true],
  ['expense', 2_500, C.tech, 'Наушники', 3],
  ['expense', 1_200, C.shopping, 'Кроссовки', 4],
  ['expense', 1_650, C.groceries, 'Сільпо', 5],
  ['expense', 900, C.entertainment, 'Кино', 7],
  ['expense', 640, C.health, 'Аптека', 9],
  ['expense', 631, C.home, '', 12],
]

const PREVIOUS_MONTH: MockRow[] = [
  ['income', 30_000, C.salary, '', 5],
  ['expense', 1_100, C.groceries, 'АТБ', 3],
  ['expense', 750, C.cafe, '', 1, true],
]

/** [сумма, дней назад] — снятие наличных с карты. */
const TRANSFERS: readonly [amount: number, daysAgo: number][] = [
  [1_000, 2],
  [500, 8],
]

const CATEGORY_LIMITS: readonly [categoryId: string, limit: number][] = [
  [C.groceries, 5_000],
  [C.transport, 2_000],
  [C.entertainment, 3_000],
]

/** Только для разработки: заполняет базу правдоподобными операциями. */
export async function seedMockData(): Promise<void> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const previousMonthEnd = subDays(monthStart, 1)
  const month = toYearMonth(now)

  const toEntry = ([type, amount, categoryId, note, daysAgo, cash]: MockRow, base: Date, floor: Date | null) => {
    const date = subDays(base, daysAgo)
    const clamped = floor && date < floor ? floor : date
    const createdAt = Date.now() - daysAgo * 60_000
    return {
      id: createId(),
      type,
      amount: Money.fromMajor(amount),
      categoryId,
      accountId: cash ? DEFAULT_ACCOUNT_IDS.cash : DEFAULT_ACCOUNT_IDS.card,
      date: toIsoDate(clamped),
      note,
      createdAt,
      updatedAt: createdAt,
    } satisfies Transaction
  }

  const toTransfer = ([amount, daysAgo]: readonly [number, number]) => {
    const createdAt = Date.now() - daysAgo * 60_000
    return {
      id: createId(),
      type: 'transfer',
      amount: Money.fromMajor(amount),
      fromAccountId: DEFAULT_ACCOUNT_IDS.card,
      toAccountId: DEFAULT_ACCOUNT_IDS.cash,
      date: toIsoDate(subDays(now, daysAgo)),
      note: 'Снял в банкомате',
      createdAt,
      updatedAt: createdAt,
    } satisfies Transaction
  }

  const transactions: Transaction[] = [
    ...CURRENT_MONTH.map((row) => toEntry(row, now, monthStart)),
    ...PREVIOUS_MONTH.map((row) => toEntry(row, previousMonthEnd, null)),
    ...TRANSFERS.map(toTransfer),
  ]

  await db.transaction('rw', [db.transactions, db.budgets, db.categoryBudgets, db.accounts], async () => {
    await db.transactions.bulkAdd(transactions)
    await db.budgets.put({ id: budgetIdFor(month), ...month, totalLimit: Money.fromMajor(15_000) })
    await db.categoryBudgets.bulkPut(categoryBudgets(month))
    await db.accounts.update(DEFAULT_ACCOUNT_IDS.cash, { initialBalance: Money.fromMajor(2_000), updatedAt: Date.now() })
  })
}

function categoryBudgets(month: YearMonth): CategoryBudget[] {
  const now = Date.now()
  return CATEGORY_LIMITS.map(([categoryId, limit]) => ({
    id: categoryBudgetIdFor(month, categoryId),
    categoryId,
    year: month.year,
    month: month.month,
    limitAmount: Money.fromMajor(limit),
    createdAt: now,
    updatedAt: now,
  }))
}

/** Удаляет базу целиком; при следующем открытии она создаётся заново со значениями по умолчанию. */
export async function resetDatabase(): Promise<void> {
  await db.delete()
  window.location.reload()
}
