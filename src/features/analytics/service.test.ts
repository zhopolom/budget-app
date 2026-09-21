import { describe, expect, it } from 'vitest'
import type { Account, Category, Transaction } from '../../types/entities'
import { Money } from '../../utils/money'
import { toTransactionViews } from '../transactions/views'
import {
  averageDailyExpense,
  buildCategoryShares,
  buildDailyExpenses,
  buildMonthAnalytics,
  compareMonths,
  findLargestExpense,
} from './service'

const MONTH = { year: 2026, month: 9 }

const ACCOUNTS: Account[] = [
  { id: 'card', name: 'Карта', type: 'card', initialBalance: 0, currency: 'UAH', createdAt: 1, updatedAt: 1 },
]

const CATEGORIES: Category[] = [
  { id: 'groceries', name: 'Продукты', icon: '🛒', type: 'expense', isSystem: true, createdAt: 1 },
  { id: 'transport', name: 'Транспорт', icon: '🚕', type: 'expense', isSystem: true, createdAt: 2 },
  { id: 'fun', name: 'Развлечения', icon: '🎬', type: 'expense', isSystem: true, createdAt: 3 },
  { id: 'salary', name: 'Зарплата', icon: '💰', type: 'income', isSystem: true, createdAt: 4 },
]

let seq = 0
const expense = (amount: number, date: string, categoryId = 'groceries'): Transaction => ({
  id: `e${(seq += 1)}`,
  type: 'expense',
  amount: Money.fromMajor(amount),
  categoryId,
  accountId: 'card',
  date,
  note: '',
  createdAt: seq,
  updatedAt: seq,
})

const income = (amount: number, date: string): Transaction => ({
  id: `i${(seq += 1)}`,
  type: 'income',
  amount: Money.fromMajor(amount),
  categoryId: 'salary',
  accountId: 'card',
  date,
  note: '',
  createdAt: seq,
  updatedAt: seq,
})

const transfer = (amount: number, date: string): Transaction => ({
  id: `t${(seq += 1)}`,
  type: 'transfer',
  amount: Money.fromMajor(amount),
  fromAccountId: 'card',
  toAccountId: 'cash',
  date,
  note: '',
  createdAt: seq,
  updatedAt: seq,
})

const TRANSACTIONS: Transaction[] = [
  expense(3_420, '2026-09-03', 'groceries'),
  expense(1_620, '2026-09-10', 'transport'),
  expense(1_100, '2026-09-10', 'fun'),
  income(32_000, '2026-09-01'),
  transfer(5_000, '2026-09-05'),
]

const VIEWS = toTransactionViews(TRANSACTIONS, CATEGORIES, ACCOUNTS)

describe('buildDailyExpenses', () => {
  it('отдаёт все дни месяца, включая пустые — у графика не должно быть дыр', () => {
    const points = buildDailyExpenses(MONTH, TRANSACTIONS)

    expect(points).toHaveLength(30)
    expect(points[0]).toEqual({ date: '2026-09-01', day: 1, expense: 0 })
    expect(points[2]).toEqual({ date: '2026-09-03', day: 3, expense: Money.fromMajor(3_420) })
  })

  it('складывает расходы одного дня и не пускает в график доходы и переводы', () => {
    const points = buildDailyExpenses(MONTH, TRANSACTIONS)

    expect(points[9].expense).toBe(Money.fromMajor(2_720))
    // 1-го был доход, 5-го перевод — в расходах их быть не должно
    expect(points[0].expense).toBe(0)
    expect(points[4].expense).toBe(0)
  })
})

describe('buildCategoryShares', () => {
  it('считает проценты от расходов периода и сортирует по убыванию', () => {
    const shares = buildCategoryShares(TRANSACTIONS, CATEGORIES)

    expect(shares.map((share) => [share.category?.name, share.percent])).toEqual([
      ['Продукты', 56],
      ['Транспорт', 26],
      ['Развлечения', 18],
    ])
    expect(shares[0].amount).toBe(Money.fromMajor(3_420))
  })

  it('доходы и переводы в категории не попадают', () => {
    expect(buildCategoryShares(TRANSACTIONS, CATEGORIES).some((share) => share.categoryId === 'salary')).toBe(false)
  })

  it('обрезает до топ-N', () => {
    expect(buildCategoryShares(TRANSACTIONS, CATEGORIES, 2)).toHaveLength(2)
  })

  it('удалённая категория остаётся в цифрах, но без названия', () => {
    const [share] = buildCategoryShares([expense(100, '2026-09-04', 'ghost')], CATEGORIES)
    expect(share.categoryId).toBe('ghost')
    expect(share.category).toBeUndefined()
    expect(share.percent).toBe(100)
  })

  it('без расходов возвращает пусто', () => {
    expect(buildCategoryShares([income(100, '2026-09-01')], CATEGORIES)).toEqual([])
  })
})

describe('compareMonths', () => {
  it('считает рост в процентах с одним знаком', () => {
    const result = compareMonths(Money.fromMajor(8_420), Money.fromMajor(7_900))
    expect(result.delta).toBe(Money.fromMajor(520))
    expect(result.deltaPercent).toBe(6.6)
  })

  it('падение показывает отрицательным', () => {
    expect(compareMonths(Money.fromMajor(7_900), Money.fromMajor(8_420)).deltaPercent).toBe(-6.2)
  })

  it('от нуля процент не считает', () => {
    const result = compareMonths(Money.fromMajor(1_000), 0)
    expect(result.deltaPercent).toBeNull()
    expect(result.delta).toBe(Money.fromMajor(1_000))
  })

  it('равные месяцы дают ноль', () => {
    expect(compareMonths(Money.fromMajor(500), Money.fromMajor(500)).deltaPercent).toBe(0)
  })
})

describe('averageDailyExpense', () => {
  it('в текущем месяце делит на прошедшие дни, а не на весь месяц', () => {
    // 21-е число: делить на 30 значило бы занизить среднее на треть
    expect(averageDailyExpense(MONTH, Money.fromMajor(6_300), '2026-09-21')).toBe(Money.fromMajor(300))
  })

  it('в прошлом месяце делит на все его дни', () => {
    expect(averageDailyExpense(MONTH, Money.fromMajor(6_000), '2026-11-05')).toBe(Money.fromMajor(200))
  })

  it('без расходов даёт ноль', () => {
    expect(averageDailyExpense(MONTH, 0, '2026-09-21')).toBe(0)
  })
})

describe('findLargestExpense', () => {
  it('находит самую крупную трату', () => {
    expect(findLargestExpense(VIEWS)?.transaction.amount).toBe(Money.fromMajor(3_420))
  })

  it('доход крупнее расхода не перебивает', () => {
    const views = toTransactionViews([income(99_000, '2026-09-01'), expense(10, '2026-09-02')], CATEGORIES, ACCOUNTS)
    expect(findLargestExpense(views)?.transaction.amount).toBe(Money.fromMajor(10))
  })

  it('без расходов отдаёт null', () => {
    expect(findLargestExpense(toTransactionViews([transfer(1_000, '2026-09-01')], CATEGORIES, ACCOUNTS))).toBeNull()
  })
})

describe('buildMonthAnalytics', () => {
  it('собирает весь экран статистики за один проход', () => {
    const analytics = buildMonthAnalytics({
      month: MONTH,
      today: '2026-09-21',
      views: VIEWS,
      previousExpense: Money.fromMajor(7_900),
      categories: CATEGORIES,
    })

    expect(analytics.totals.expense).toBe(Money.fromMajor(6_140))
    expect(analytics.totals.income).toBe(Money.fromMajor(32_000))
    expect(analytics.dailyExpenses).toHaveLength(30)
    expect(analytics.daysWithExpenses).toBe(2)
    expect(analytics.topCategories[0].category?.name).toBe('Продукты')
    expect(analytics.comparison.deltaPercent).toBe(-22.3)
    expect(analytics.largestExpense?.transaction.amount).toBe(Money.fromMajor(3_420))
    expect(analytics.transactionCount).toBe(5)
  })

  it('на пустом месяце не падает', () => {
    const analytics = buildMonthAnalytics({
      month: MONTH,
      today: '2026-09-21',
      views: [],
      previousExpense: 0,
      categories: CATEGORIES,
    })

    expect(analytics.totals).toEqual({ income: 0, expense: 0, net: 0 })
    expect(analytics.topCategories).toEqual([])
    expect(analytics.largestExpense).toBeNull()
    expect(analytics.comparison.deltaPercent).toBeNull()
    expect(analytics.averageDailyExpense).toBe(0)
  })
})
