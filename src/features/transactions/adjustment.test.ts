import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import type { Account, AdjustmentTransaction, Category, Transaction } from '../../types/entities'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { buildMonthAnalytics } from '../analytics/service'
import { toCsv } from '../backup/csv'
import { buildCategoryBudgetProgress } from '../budgets/calculations'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import {
  calculateAccountActivity,
  calculateAccountBalances,
  calculateCategoryTotals,
  calculateTotalBalance,
  calculateTotals,
} from './calculations'
import { applyFilters, EMPTY_FILTERS } from './filters'
import { groupByDay } from './grouping'
import { transactionIcon, transactionTitle } from './labels'
import { transactionsRepository } from './repository'
import { toTransactionViews } from './views'

/**
 * Корректировка остатка (0.4): меняет счёт и общий капитал, и больше ничего.
 * В доходы, расходы, категории, бюджет и аналитику она не попадает —
 * иначе сверка с банком искажала бы картину трат.
 */

const { card, cash } = DEFAULT_ACCOUNT_IDS

const ACCOUNTS: Account[] = [
  { id: card, name: 'Карта', type: 'card', initialBalance: Money.fromMajor(1_000), currency: 'UAH', createdAt: 1, updatedAt: 1 },
  { id: cash, name: 'Наличные', type: 'cash', initialBalance: 0, currency: 'UAH', createdAt: 2, updatedAt: 2 },
]

const GROCERIES: Category = { id: C.groceries, name: 'Продукты', icon: '🛒', type: 'expense', isSystem: true, createdAt: 1 }

const expense: Transaction = {
  id: 'e',
  type: 'expense',
  amount: Money.fromMajor(430),
  categoryId: C.groceries,
  accountId: card,
  date: '2026-09-14',
  note: 'АТБ',
  createdAt: 1,
  updatedAt: 1,
}

const income: Transaction = {
  id: 'i',
  type: 'income',
  amount: Money.fromMajor(2_000),
  categoryId: C.salary,
  accountId: card,
  date: '2026-09-10',
  note: '',
  createdAt: 2,
  updatedAt: 2,
}

const decrease: AdjustmentTransaction = {
  id: 'a-minus',
  type: 'adjustment',
  amount: Money.fromMajor(213),
  accountId: card,
  direction: 'decrease',
  date: '2026-09-20',
  note: 'Сверка с банком',
  createdAt: 3,
  updatedAt: 3,
}

const increase: AdjustmentTransaction = { ...decrease, id: 'a-plus', amount: Money.fromMajor(50), direction: 'increase' }

const ALL: Transaction[] = [expense, income, decrease, increase]

describe('корректировка и остатки', () => {
  it('отрицательная уменьшает остаток счёта, положительная увеличивает', () => {
    const balances = calculateAccountBalances(ACCOUNTS, ALL)
    // 1000 − 430 + 2000 − 213 + 50
    expect(balances.get(card)).toBe(Money.fromMajor(2_407))
    expect(balances.get(cash)).toBe(0)
  })

  it('общий капитал учитывает корректировки', () => {
    expect(calculateTotalBalance(ACCOUNTS, ALL)).toBe(Money.fromMajor(2_407))
  })

  it('в оборотах счёта идёт отдельной строкой и считается операцией', () => {
    const activity = calculateAccountActivity(card, ALL)
    expect(activity.income).toBe(Money.fromMajor(2_000))
    expect(activity.expense).toBe(Money.fromMajor(430))
    expect(activity.adjustment).toBe(Money.fromMajor(-163))
    expect(activity.count).toBe(4)
  })
})

describe('корректировка вне доходов и расходов', () => {
  it('не входит в итоги периода', () => {
    expect(calculateTotals(ALL)).toEqual({
      income: Money.fromMajor(2_000),
      expense: Money.fromMajor(430),
      net: Money.fromMajor(1_570),
    })
  })

  it('не входит в расходы по категориям и в лимиты', () => {
    const totals = calculateCategoryTotals(ALL)
    expect([...totals.entries()]).toEqual([[C.groceries, Money.fromMajor(430)]])

    const progress = buildCategoryBudgetProgress(
      [{ id: 'l', categoryId: C.groceries, year: 2026, month: 9, limitAmount: Money.fromMajor(1_000), createdAt: 1, updatedAt: 1 }],
      totals,
      [GROCERIES],
    )
    expect(progress[0].spent).toBe(Money.fromMajor(430))
  })

  it('не попадает в аналитику: ни в итоги, ни в средний день, ни в крупнейшую трату', () => {
    const views = toTransactionViews(ALL, [GROCERIES], ACCOUNTS)
    const analytics = buildMonthAnalytics({
      month: { year: 2026, month: 9 },
      today: '2026-09-30',
      views,
      previousExpense: 0,
      categories: [GROCERIES],
    })

    expect(analytics.totals.expense).toBe(Money.fromMajor(430))
    expect(analytics.averageDailyExpense).toBe(Math.round(Money.fromMajor(430) / 30 / 100) * 100)
    expect(analytics.largestExpense?.transaction.id).toBe('e')
    expect(analytics.daysWithExpenses).toBe(1)
    expect(analytics.dailyExpenses.find((point) => point.date === '2026-09-20')?.expense).toBe(0)
  })

  it('в группах по дням не считается ни расходом, ни доходом', () => {
    const groups = groupByDay(toTransactionViews(ALL, [GROCERIES], ACCOUNTS))
    const day = groups.find((group) => group.date === '2026-09-20')
    expect(day?.items).toHaveLength(2)
    expect(day?.expense).toBe(0)
    expect(day?.income).toBe(0)
  })
})

describe('корректировка в интерфейсе', () => {
  const views = toTransactionViews(ALL, [GROCERIES], ACCOUNTS)
  const view = views.find((item) => item.transaction.id === 'a-minus')!

  it('связана со счётом, но не с категорией', () => {
    expect(view.account?.id).toBe(card)
    expect(view.category).toBeUndefined()
    expect(transactionTitle(view)).toBe('Корректировка остатка')
    expect(transactionIcon(view)).toBe('⚖️')
  })

  it('находится поиском по счёту и фильтром по типу, но не фильтром по категории', () => {
    expect(applyFilters(views, EMPTY_FILTERS, 'карта').map((item) => item.transaction.id)).toContain('a-minus')
    expect(applyFilters(views, { ...EMPTY_FILTERS, types: ['adjustment'] }, '')).toHaveLength(2)
    expect(applyFilters(views, { ...EMPTY_FILTERS, categoryIds: [C.groceries] }, '').map((item) => item.transaction.id)).toEqual(['e'])
  })

  it('в CSV выгружается со знаком по направлению и со счётом', () => {
    const [, ...rows] = toCsv([view, views.find((item) => item.transaction.id === 'a-plus')!], 'UAH').split('\r\n')
    expect(rows[0]).toBe('2026-09-20,Корректировка,-213.00,UAH,,Карта,,,Сверка с банком,Сверка')
    expect(rows[1]).toBe('2026-09-20,Корректировка,50.00,UAH,,Карта,,,Сверка с банком,Сверка')
  })
})

describe('корректировка в базе', () => {
  beforeEach(resetTestDatabase)

  it('сохраняется, читается и не ломает остаток', async () => {
    await transactionsRepository.create({
      type: 'adjustment',
      amount: Money.fromMajor(213),
      accountId: card,
      direction: 'decrease',
      date: '2026-09-20',
      note: '',
    })

    const stored = await db.transactions.toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0].type).toBe('adjustment')
    expect(calculateTotalBalance(await db.accounts.toArray(), stored)).toBe(Money.fromMajor(-213))
    // Корректировка не меняет «последний выбранный счёт» для новых операций? Меняет — это тот же счёт
    expect((await db.settings.get('app'))?.lastAccountId).toBe(card)
  })
})
