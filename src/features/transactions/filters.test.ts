import { describe, expect, it } from 'vitest'
import type { Account, Category, Transaction } from '../../types/entities'
import { Money } from '../../utils/money'
import {
  applyFilters,
  countActiveFilters,
  EMPTY_FILTERS,
  matchesQuery,
  normalizeSearch,
  resolvePeriod,
  type TransactionFilters,
} from './filters'
import { groupByDay, dailyExpenses } from './grouping'
import { toTransactionViews } from './views'

const ACCOUNTS: Account[] = [
  { id: 'card', name: 'Монобанк', type: 'card', initialBalance: 0, currency: 'UAH', createdAt: 1, updatedAt: 1 },
  { id: 'cash', name: 'Наличные', type: 'cash', initialBalance: 0, currency: 'UAH', createdAt: 2, updatedAt: 2 },
]

const CATEGORIES: Category[] = [
  { id: 'groceries', name: 'Продукты', icon: '🛒', type: 'expense', isSystem: true, createdAt: 1 },
  { id: 'salary', name: 'Зарплата', icon: '💰', type: 'income', isSystem: true, createdAt: 2 },
]

const TRANSACTIONS: Transaction[] = [
  {
    id: 'a',
    type: 'expense',
    amount: Money.fromMajor(430),
    categoryId: 'groceries',
    accountId: 'card',
    date: '2026-09-21',
    note: 'АТБ',
    createdAt: 3,
    updatedAt: 3,
  },
  {
    id: 'b',
    type: 'expense',
    amount: Money.fromMajor(90),
    categoryId: 'groceries',
    accountId: 'cash',
    date: '2026-09-21',
    note: 'Кофе с собой',
    createdAt: 2,
    updatedAt: 2,
  },
  {
    id: 'c',
    type: 'income',
    amount: Money.fromMajor(32_000),
    categoryId: 'salary',
    accountId: 'card',
    date: '2026-09-01',
    note: '',
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'd',
    type: 'transfer',
    amount: Money.fromMajor(1_000),
    fromAccountId: 'card',
    toAccountId: 'cash',
    date: '2026-09-15',
    note: 'Банкомат',
    createdAt: 4,
    updatedAt: 4,
  },
]

const VIEWS = toTransactionViews(TRANSACTIONS, CATEGORIES, ACCOUNTS)
const filters = (patch: Partial<TransactionFilters> = {}): TransactionFilters => ({ ...EMPTY_FILTERS, ...patch })
const ids = (result: ReturnType<typeof applyFilters>) => result.map((view) => view.transaction.id).sort()

describe('поиск', () => {
  it('приводит регистр и ё к общему виду', () => {
    expect(normalizeSearch('  Кофе  ')).toBe('кофе')
    expect(normalizeSearch('Ёлка')).toBe('елка')
  })

  it('ищет по комментарию', () => {
    expect(ids(applyFilters(VIEWS, filters(), 'атб'))).toEqual(['a'])
  })

  it('ищет по названию категории', () => {
    expect(ids(applyFilters(VIEWS, filters(), 'продукты'))).toEqual(['a', 'b'])
  })

  it('ищет по названию счёта, у перевода — по обеим сторонам', () => {
    expect(ids(applyFilters(VIEWS, filters(), 'монобанк'))).toEqual(['a', 'c', 'd'])
    expect(ids(applyFilters(VIEWS, filters(), 'наличные'))).toEqual(['b', 'd'])
  })

  it('пустой запрос ничего не отсеивает', () => {
    expect(applyFilters(VIEWS, filters(), '   ')).toHaveLength(4)
    expect(matchesQuery(VIEWS[0], '')).toBe(true)
  })

  it('ничего не находит по мусору', () => {
    expect(applyFilters(VIEWS, filters(), 'ыва')).toHaveLength(0)
  })
})

describe('фильтры', () => {
  it('по типу', () => {
    expect(ids(applyFilters(VIEWS, filters({ types: ['expense'] }), ''))).toEqual(['a', 'b'])
    expect(ids(applyFilters(VIEWS, filters({ types: ['transfer'] }), ''))).toEqual(['d'])
    expect(ids(applyFilters(VIEWS, filters({ types: ['income', 'transfer'] }), ''))).toEqual(['c', 'd'])
  })

  it('по счёту: перевод попадает с любой стороны', () => {
    expect(ids(applyFilters(VIEWS, filters({ accountIds: ['cash'] }), ''))).toEqual(['b', 'd'])
    expect(ids(applyFilters(VIEWS, filters({ accountIds: ['card'] }), ''))).toEqual(['a', 'c', 'd'])
  })

  it('по категории: переводы исключаются, у них категории нет', () => {
    expect(ids(applyFilters(VIEWS, filters({ categoryIds: ['groceries'] }), ''))).toEqual(['a', 'b'])
    expect(applyFilters(VIEWS, filters({ categoryIds: ['groceries'], types: ['transfer'] }), '')).toHaveLength(0)
  })

  it('по сумме, границы включительно', () => {
    expect(ids(applyFilters(VIEWS, filters({ minAmount: Money.fromMajor(1_000) }), ''))).toEqual(['c', 'd'])
    expect(ids(applyFilters(VIEWS, filters({ maxAmount: Money.fromMajor(430) }), ''))).toEqual(['a', 'b'])
    expect(
      ids(applyFilters(VIEWS, filters({ minAmount: Money.fromMajor(90), maxAmount: Money.fromMajor(430) }), '')),
    ).toEqual(['a', 'b'])
  })

  it('по своему периоду', () => {
    expect(ids(applyFilters(VIEWS, filters({ period: 'custom', from: '2026-09-15' }), ''))).toEqual(['a', 'b', 'd'])
    expect(ids(applyFilters(VIEWS, filters({ period: 'custom', to: '2026-09-01' }), ''))).toEqual(['c'])
  })

  it('фильтры и поиск работают вместе', () => {
    expect(ids(applyFilters(VIEWS, filters({ accountIds: ['card'] }), 'продукты'))).toEqual(['a'])
  })
})

describe('countActiveFilters', () => {
  it('пустые фильтры — ноль', () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0)
  })

  it('считает каждое ограничение один раз', () => {
    expect(
      countActiveFilters(
        filters({ types: ['expense', 'income'], accountIds: ['card'], minAmount: 100, period: 'year' }),
      ),
    ).toBe(4)
  })
})

describe('resolvePeriod', () => {
  const month = { year: 2026, month: 9 }

  it('месяц, квартал и год считаются от выбранного месяца', () => {
    expect(resolvePeriod(filters(), month)).toEqual({ start: '2026-09-01', end: '2026-09-30' })
    expect(resolvePeriod(filters({ period: 'quarter' }), month)).toEqual({ start: '2026-07-01', end: '2026-09-30' })
    expect(resolvePeriod(filters({ period: 'year' }), month)).toEqual({ start: '2025-10-01', end: '2026-09-30' })
  })

  it('«всё время» не ограничивает выборку', () => {
    expect(resolvePeriod(filters({ period: 'all' }), month)).toBeNull()
  })

  it('свой период с одной границей не ограничивает вторую', () => {
    expect(resolvePeriod(filters({ period: 'custom', from: '2026-01-01' }), month)).toEqual({
      start: '2026-01-01',
      end: '9999-12-31',
    })
    expect(resolvePeriod(filters({ period: 'custom' }), month)).toBeNull()
  })
})

describe('группировка по дням', () => {
  it('новые дни сверху, внутри дня — новые операции сверху', () => {
    const groups = groupByDay(VIEWS)
    expect(groups.map((group) => group.date)).toEqual(['2026-09-21', '2026-09-15', '2026-09-01'])
    expect(groups[0].items.map((view) => view.transaction.id)).toEqual(['a', 'b'])
  })

  it('считает расходы и доходы дня, перевод не трогает ни те, ни другие', () => {
    const [first, transferDay, salaryDay] = groupByDay(VIEWS)
    expect(first.expense).toBe(Money.fromMajor(520))
    expect(first.income).toBe(0)
    expect(transferDay.expense).toBe(0)
    expect(transferDay.income).toBe(0)
    expect(salaryDay.income).toBe(Money.fromMajor(32_000))
  })

  it('пустой список — пустые группы', () => {
    expect(groupByDay([])).toEqual([])
  })
})

describe('dailyExpenses', () => {
  it('складывает только расходы по дням', () => {
    const totals = dailyExpenses(VIEWS)
    expect(totals.get('2026-09-21')).toBe(Money.fromMajor(520))
    expect(totals.get('2026-09-15')).toBeUndefined()
    expect(totals.get('2026-09-01')).toBeUndefined()
    expect(totals.size).toBe(1)
  })
})
