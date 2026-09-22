import { describe, expect, it } from 'vitest'
import type { Account, RecurringTransaction, Transaction } from '../../types/entities'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { calculateDailyGuidance, calculateForecast, listUpcoming } from './service'

const { card, cash } = DEFAULT_ACCOUNT_IDS
const TODAY = '2026-09-22'

const ACCOUNTS: Account[] = [
  { id: card, name: 'Карта', type: 'card', initialBalance: Money.fromMajor(18_420), currency: 'UAH', createdAt: 1, updatedAt: 1 },
  { id: cash, name: 'Наличные', type: 'cash', initialBalance: 0, currency: 'UAH', createdAt: 2, updatedAt: 2 },
]

let counter = 0
function rule(overrides: Partial<RecurringTransaction> & { type?: 'expense' | 'income' }): RecurringTransaction {
  counter += 1
  return {
    id: `rule-${counter}`,
    type: 'expense',
    amount: Money.fromMajor(199),
    categoryId: C.subscriptions,
    accountId: card,
    note: '',
    frequency: 'monthly',
    interval: 1,
    startDate: '2026-01-23',
    nextOccurrence: '2026-09-23',
    isActive: true,
    createdAt: counter,
    updatedAt: counter,
    ...overrides,
  } as RecurringTransaction
}

function transferRule(overrides: Partial<RecurringTransaction> = {}): RecurringTransaction {
  counter += 1
  return {
    id: `transfer-${counter}`,
    type: 'transfer',
    amount: Money.fromMajor(2_000),
    fromAccountId: card,
    toAccountId: cash,
    note: 'На накопительный',
    frequency: 'monthly',
    interval: 1,
    startDate: '2026-01-25',
    nextOccurrence: '2026-09-25',
    isActive: true,
    createdAt: counter,
    updatedAt: counter,
    ...overrides,
  } as RecurringTransaction
}

const forecastOf = (rules: RecurringTransaction[], transactions: Transaction[] = [], monthlyLimit: number | null = null) =>
  calculateForecast({ today: TODAY, accounts: ACCOUNTS, transactions, rules, monthlyLimit })

describe('listUpcoming', () => {
  it('раскладывает вхождения по датам и не создаёт ничего раньше nextOccurrence', () => {
    const spotify = rule({ note: 'Spotify', nextOccurrence: '2026-09-23' })
    const internet = rule({ note: 'Интернет', amount: Money.fromMajor(300), startDate: '2026-01-25', nextOccurrence: '2026-09-25' })
    const salary = rule({ type: 'income', note: 'Зарплата', amount: Money.fromMajor(32_000), categoryId: C.salary, startDate: '2026-01-01', nextOccurrence: '2026-10-01' })

    // 23 октября — уже за горизонтом
    const upcoming = listUpcoming([internet, salary, spotify], TODAY, '2026-10-22')
    expect(upcoming.map((item) => [item.date, item.rule.note])).toEqual([
      ['2026-09-23', 'Spotify'],
      ['2026-09-25', 'Интернет'],
      ['2026-10-01', 'Зарплата'],
    ])
  })

  it('ежедневное расписание даёт вхождение на каждый день горизонта, включая сегодня', () => {
    const daily = rule({ frequency: 'daily', startDate: '2026-09-01', nextOccurrence: TODAY })
    expect(listUpcoming([daily], TODAY, '2026-09-24').map((item) => item.date)).toEqual([
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
    ])
  })

  it('выключенные расписания и перевод «на себя» не попадают в прогноз', () => {
    const paused = rule({ isActive: false })
    const self = transferRule({ toAccountId: card })
    expect(listUpcoming([paused, self], TODAY, '2026-10-22')).toEqual([])
  })

  it('закончившееся расписание не тянется за дату окончания', () => {
    const ending = rule({ frequency: 'weekly', startDate: '2026-09-01', nextOccurrence: '2026-09-22', endDate: '2026-09-30' })
    expect(listUpcoming([ending], TODAY, '2026-10-22').map((item) => item.date)).toEqual(['2026-09-22', '2026-09-29'])
  })

  it('просроченное nextOccurrence не рисует прошлое: оно досоздастся при запуске', () => {
    const overdue = rule({ frequency: 'daily', startDate: '2026-09-01', nextOccurrence: '2026-09-10' })
    const dates = listUpcoming([overdue], TODAY, '2026-09-23').map((item) => item.date)
    expect(dates).toEqual(['2026-09-22', '2026-09-23'])
  })

  it('ограничивает список и держит порядок создания внутри одного дня', () => {
    const second = rule({ note: 'Второе', createdAt: 20 })
    const first = rule({ note: 'Первое', createdAt: 10 })
    const later = rule({ note: 'Позже', nextOccurrence: '2026-09-30' })
    expect(listUpcoming([later, second, first], TODAY, '2026-10-22', 2).map((item) => item.rule.note)).toEqual([
      'Первое',
      'Второе',
    ])
  })
})

describe('calculateForecast', () => {
  it('ожидаемые доходы: зарплата до конца месяца поднимает прогноз', () => {
    const salary = rule({ type: 'income', amount: Money.fromMajor(32_000), categoryId: C.salary, startDate: '2026-01-30', nextOccurrence: '2026-09-30' })
    const forecast = forecastOf([salary])

    expect(forecast.currentBalance).toBe(Money.fromMajor(18_420))
    expect(forecast.expectedIncome).toBe(Money.fromMajor(32_000))
    expect(forecast.expectedExpense).toBe(0)
    expect(forecast.projectedBalance).toBe(Money.fromMajor(50_420))
    expect(forecast.until).toBe('2026-09-30')
  })

  it('ожидаемые расходы: каждое вхождение до конца месяца считается отдельно', () => {
    const spotify = rule({ amount: Money.fromMajor(199), nextOccurrence: '2026-09-23' })
    const daily = rule({ amount: Money.fromMajor(100), frequency: 'daily', startDate: '2026-09-01', nextOccurrence: '2026-09-23' })
    const forecast = forecastOf([spotify, daily])

    // 199 + 8 дней по 100 (23–30 сентября)
    expect(forecast.expectedExpense).toBe(Money.fromMajor(999))
    expect(forecast.scheduledCount).toBe(9)
    expect(forecast.projectedBalance).toBe(Money.fromMajor(18_420 - 999))
  })

  it('расписание после конца месяца в прогноз не входит', () => {
    const october = rule({ type: 'income', amount: Money.fromMajor(32_000), categoryId: C.salary, startDate: '2026-01-01', nextOccurrence: '2026-10-01' })
    const forecast = forecastOf([october])
    expect(forecast.expectedIncome).toBe(0)
    expect(forecast.projectedBalance).toBe(forecast.currentBalance)
    expect(forecast.scheduledCount).toBe(0)
  })

  it('переводы не меняют прогноз: деньги перекладываются, а не уходят', () => {
    const forecast = forecastOf([transferRule()])
    expect(forecast.expectedIncome).toBe(0)
    expect(forecast.expectedExpense).toBe(0)
    expect(forecast.projectedBalance).toBe(Money.fromMajor(18_420))
    expect(forecast.scheduledCount).toBe(0)
  })

  it('корректировка сидит в текущем балансе, но не в ожидаемых суммах', () => {
    const adjustment: Transaction = {
      id: 'adj',
      type: 'adjustment',
      accountId: card,
      amount: Money.fromMajor(213),
      direction: 'decrease',
      date: '2026-09-20',
      note: '',
      createdAt: 1,
      updatedAt: 1,
    }
    const spotify = rule({ amount: Money.fromMajor(199), nextOccurrence: '2026-09-23' })
    const forecast = forecastOf([spotify], [adjustment])

    expect(forecast.currentBalance).toBe(Money.fromMajor(18_420 - 213))
    expect(forecast.expectedExpense).toBe(Money.fromMajor(199))
    expect(forecast.projectedBalance).toBe(Money.fromMajor(18_420 - 213 - 199))
  })

  it('без общего бюджета ориентира нет', () => {
    expect(forecastOf([]).guidance).toBeNull()
  })

  it('ориентир считается по расходам текущего месяца, корректировки его не трогают', () => {
    const spent: Transaction = {
      id: 'spent',
      type: 'expense',
      amount: Money.fromMajor(3_800),
      categoryId: C.groceries,
      accountId: card,
      date: '2026-09-05',
      note: '',
      createdAt: 1,
      updatedAt: 1,
    }
    const lastMonth: Transaction = { ...spent, id: 'old', date: '2026-08-30' }
    const adjustment: Transaction = {
      id: 'adj',
      type: 'adjustment',
      accountId: card,
      amount: Money.fromMajor(500),
      direction: 'decrease',
      date: '2026-09-06',
      note: '',
      createdAt: 2,
      updatedAt: 2,
    }

    const forecast = forecastOf([], [spent, lastMonth, adjustment], Money.fromMajor(10_000))
    expect(forecast.guidance).toEqual({
      remainingBudget: Money.fromMajor(6_200),
      daysRemaining: 9,
      recommendedDailyBudget: Money.fromMajor(688),
    })
  })
})

describe('calculateDailyGuidance', () => {
  it('делит остаток на дни до конца месяца, включая сегодня, и округляет вниз до целых', () => {
    // 6 200 / 9 = 688,88… → 688
    expect(calculateDailyGuidance(Money.fromMajor(10_000), Money.fromMajor(3_800), '2026-09-22')).toEqual({
      remainingBudget: Money.fromMajor(6_200),
      daysRemaining: 9,
      recommendedDailyBudget: Money.fromMajor(688),
    })
  })

  it('в последний день месяца остаётся один день', () => {
    const guidance = calculateDailyGuidance(Money.fromMajor(1_000), Money.fromMajor(250), '2026-02-28')
    expect(guidance.daysRemaining).toBe(1)
    expect(guidance.recommendedDailyBudget).toBe(Money.fromMajor(750))
  })

  it('превышенный лимит даёт нулевой ориентир и отрицательный остаток', () => {
    const guidance = calculateDailyGuidance(Money.fromMajor(1_000), Money.fromMajor(1_300), '2026-09-22')
    expect(guidance.remainingBudget).toBe(Money.fromMajor(-300))
    expect(guidance.recommendedDailyBudget).toBe(0)
  })

  it('копейки не всплывают: 100 ₴ на 3 дня — это 33 ₴, а не 33,33', () => {
    expect(calculateDailyGuidance(Money.fromMajor(100), 0, '2026-09-28').recommendedDailyBudget).toBe(Money.fromMajor(33))
  })
})
