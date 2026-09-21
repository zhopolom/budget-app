import { describe, expect, it } from 'vitest'
import type { Account, Transaction } from '../../types/entities'
import { Money } from '../../utils/money'
import {
  calculateAccountActivity,
  calculateAccountBalances,
  calculateCategoryTotals,
  calculateTotalBalance,
  calculateTotals,
  compareNewestFirst,
  signedAmount,
} from './calculations'
import { accountIdsOf, balanceDelta, categoryIdOf, isEntry, isTransfer } from './model'

const account = (id: string, initialBalance: number): Account => ({
  id,
  name: id,
  type: 'card',
  initialBalance: Money.fromMajor(initialBalance),
  currency: 'UAH',
  createdAt: 1,
  updatedAt: 1,
})

const ACCOUNTS = [account('card', 1_000), account('cash', 200)]

let seq = 0
const entry = (type: 'expense' | 'income', amount: number, accountId: string, categoryId = 'groceries'): Transaction => ({
  id: `e${(seq += 1)}`,
  type,
  amount: Money.fromMajor(amount),
  accountId,
  categoryId,
  date: '2026-09-10',
  note: '',
  createdAt: seq,
  updatedAt: seq,
})

const transfer = (amount: number, fromAccountId: string, toAccountId: string): Transaction => ({
  id: `t${(seq += 1)}`,
  type: 'transfer',
  amount: Money.fromMajor(amount),
  fromAccountId,
  toAccountId,
  date: '2026-09-10',
  note: '',
  createdAt: seq,
  updatedAt: seq,
})

describe('модель операции', () => {
  it('различает перевод и обычную операцию', () => {
    expect(isTransfer(transfer(100, 'card', 'cash'))).toBe(true)
    expect(isEntry(transfer(100, 'card', 'cash'))).toBe(false)
    expect(isEntry(entry('expense', 100, 'card'))).toBe(true)
  })

  it('у перевода нет категории и есть два счёта', () => {
    const moved = transfer(100, 'card', 'cash')
    expect(categoryIdOf(moved)).toBeNull()
    expect(accountIdsOf(moved)).toEqual(['card', 'cash'])
    expect(accountIdsOf(entry('expense', 100, 'card'))).toEqual(['card'])
  })

  it('перевод снимает со счёта-источника и добавляет счёту-получателю', () => {
    const moved = transfer(500, 'card', 'cash')
    expect(balanceDelta(moved, 'card')).toBe(Money.fromMajor(-500))
    expect(balanceDelta(moved, 'cash')).toBe(Money.fromMajor(500))
    expect(balanceDelta(moved, 'savings')).toBe(0)
  })

  it('у перевода нет знака: в доходы и расходы он не попадает', () => {
    expect(signedAmount(transfer(500, 'card', 'cash'))).toBe(0)
    expect(signedAmount(entry('expense', 500, 'card'))).toBe(Money.fromMajor(-500))
    expect(signedAmount(entry('income', 500, 'card'))).toBe(Money.fromMajor(500))
  })
})

describe('calculateTotals', () => {
  it('не считает переводы ни доходом, ни расходом', () => {
    const totals = calculateTotals([
      entry('income', 1_000, 'card'),
      entry('expense', 300, 'card'),
      transfer(500, 'card', 'cash'),
    ])

    expect(totals).toEqual({
      income: Money.fromMajor(1_000),
      expense: Money.fromMajor(300),
      net: Money.fromMajor(700),
    })
  })

  it('из одних переводов даёт нули', () => {
    expect(calculateTotals([transfer(500, 'card', 'cash'), transfer(200, 'cash', 'card')])).toEqual({
      income: 0,
      expense: 0,
      net: 0,
    })
  })
})

describe('calculateTotalBalance', () => {
  it('перевод не меняет общий капитал', () => {
    const before = calculateTotalBalance(ACCOUNTS, [])
    const after = calculateTotalBalance(ACCOUNTS, [transfer(500, 'card', 'cash')])
    expect(after).toBe(before)
    expect(after).toBe(Money.fromMajor(1_200))
  })

  it('доходы и расходы капитал меняют', () => {
    const balance = calculateTotalBalance(ACCOUNTS, [entry('income', 100, 'card'), entry('expense', 40, 'cash')])
    expect(balance).toBe(Money.fromMajor(1_260))
  })
})

describe('calculateAccountBalances', () => {
  it('перевод переносит сумму между счетами, сумма остатков не меняется', () => {
    const balances = calculateAccountBalances(ACCOUNTS, [transfer(500, 'card', 'cash')])

    expect(balances.get('card')).toBe(Money.fromMajor(500))
    expect(balances.get('cash')).toBe(Money.fromMajor(700))
    expect(Money.sum([...balances.values()])).toBe(Money.fromMajor(1_200))
  })

  it('учитывает расходы, доходы и переводы вместе', () => {
    const balances = calculateAccountBalances(ACCOUNTS, [
      entry('expense', 100, 'card'),
      entry('income', 50, 'cash'),
      transfer(300, 'card', 'cash'),
    ])

    expect(balances.get('card')).toBe(Money.fromMajor(600))
    expect(balances.get('cash')).toBe(Money.fromMajor(550))
  })

  it('игнорирует операции удалённых счетов', () => {
    const balances = calculateAccountBalances(ACCOUNTS, [
      entry('expense', 100, 'ghost'),
      transfer(300, 'ghost', 'cash'),
    ])

    expect(balances.get('card')).toBe(Money.fromMajor(1_000))
    // Приход перевода зачисляется, даже если счёт-источник удалён
    expect(balances.get('cash')).toBe(Money.fromMajor(500))
  })

  it('перевод «внутри счёта» остатка не меняет', () => {
    const balances = calculateAccountBalances(ACCOUNTS, [transfer(500, 'card', 'card')])
    expect(balances.get('card')).toBe(Money.fromMajor(1_000))
  })
})

describe('calculateAccountActivity', () => {
  it('раскладывает обороты счёта на доходы, расходы и переводы', () => {
    const activity = calculateAccountActivity('card', [
      entry('expense', 100, 'card'),
      entry('expense', 40, 'cash'),
      entry('income', 900, 'card'),
      transfer(300, 'card', 'cash'),
      transfer(50, 'cash', 'card'),
    ])

    expect(activity).toEqual({
      income: Money.fromMajor(900),
      expense: Money.fromMajor(100),
      transferOut: Money.fromMajor(300),
      transferIn: Money.fromMajor(50),
      count: 4,
    })
  })
})

describe('calculateCategoryTotals', () => {
  it('считает только расходы и только по категориям', () => {
    const totals = calculateCategoryTotals([
      entry('expense', 400, 'card', 'groceries'),
      entry('expense', 150, 'cash', 'groceries'),
      entry('expense', 200, 'card', 'transport'),
      entry('income', 900, 'card', 'salary'),
      transfer(300, 'card', 'cash'),
    ])

    expect(totals.get('groceries')).toBe(Money.fromMajor(550))
    expect(totals.get('transport')).toBe(Money.fromMajor(200))
    expect(totals.get('salary')).toBeUndefined()
    expect(totals.size).toBe(2)
  })
})

describe('compareNewestFirst', () => {
  it('сортирует по дате, внутри дня — по времени создания', () => {
    const rows = [
      { date: '2026-09-01', createdAt: 5 },
      { date: '2026-09-10', createdAt: 1 },
      { date: '2026-09-10', createdAt: 9 },
    ]
    expect([...rows].sort(compareNewestFirst)).toEqual([
      { date: '2026-09-10', createdAt: 9 },
      { date: '2026-09-10', createdAt: 1 },
      { date: '2026-09-01', createdAt: 5 },
    ])
  })
})
