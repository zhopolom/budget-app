import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { calculateAccountBalances } from '../transactions/calculations'
import { transactionsRepository } from '../transactions/repository'
import { planReconciliation, reconcileAccount } from './service'

const { card } = DEFAULT_ACCOUNT_IDS

async function balanceOf(accountId: string): Promise<number> {
  return calculateAccountBalances(await db.accounts.toArray(), await db.transactions.toArray()).get(accountId) ?? 0
}

describe('planReconciliation', () => {
  it('в банке меньше — корректировка вниз', () => {
    expect(planReconciliation(Money.fromMajor(12_430), Money.fromMajor(12_217))).toEqual({
      current: Money.fromMajor(12_430),
      actual: Money.fromMajor(12_217),
      difference: Money.fromMajor(-213),
      direction: 'decrease',
      amount: Money.fromMajor(213),
    })
  })

  it('в банке больше — корректировка вверх', () => {
    const plan = planReconciliation(Money.fromMajor(100), Money.fromMajor(150))
    expect(plan.direction).toBe('increase')
    expect(plan.amount).toBe(Money.fromMajor(50))
  })

  it('точное совпадение — корректировка не нужна', () => {
    const plan = planReconciliation(Money.fromMajor(100), Money.fromMajor(100))
    expect(plan.direction).toBe(null)
    expect(plan.amount).toBe(0)
  })

  it('работает и с отрицательным остатком: кредитка в минусе', () => {
    const plan = planReconciliation(Money.fromMajor(-500), Money.fromMajor(-720))
    expect(plan.direction).toBe('decrease')
    expect(plan.amount).toBe(Money.fromMajor(220))
  })
})

describe('reconcileAccount', () => {
  beforeEach(async () => {
    await resetTestDatabase()
    await transactionsRepository.create({
      type: 'income',
      amount: Money.fromMajor(12_430),
      categoryId: C.salary,
      accountId: card,
      date: '2026-09-01',
      note: '',
    })
  })

  it('после корректировки остаток равен фактическому', async () => {
    const adjustment = await reconcileAccount({
      accountId: card,
      actual: Money.fromMajor(12_217),
      expectedDifference: Money.fromMajor(-213),
      date: '2026-09-22',
      note: 'Сверка с банком',
    })

    expect(adjustment).toMatchObject({ type: 'adjustment', direction: 'decrease', amount: Money.fromMajor(213) })
    expect(await balanceOf(card)).toBe(Money.fromMajor(12_217))
  })

  it('положительная разница создаёт корректировку вверх', async () => {
    await reconcileAccount({
      accountId: card,
      actual: Money.fromMajor(12_500),
      expectedDifference: Money.fromMajor(70),
      date: '2026-09-22',
      note: '',
    })
    expect(await balanceOf(card)).toBe(Money.fromMajor(12_500))
  })

  it('при точном совпадении ничего не создаёт', async () => {
    const result = await reconcileAccount({
      accountId: card,
      actual: Money.fromMajor(12_430),
      expectedDifference: 0,
      date: '2026-09-22',
      note: '',
    })

    expect(result).toBe(null)
    expect(await db.transactions.count()).toBe(1)
  })

  it('не создаёт корректировку, если остаток изменился после превью', async () => {
    // Пока пользователь смотрел на превью с разницей −213, пришла ещё одна операция
    await transactionsRepository.create({
      type: 'expense',
      amount: Money.fromMajor(100),
      categoryId: C.groceries,
      accountId: card,
      date: '2026-09-22',
      note: '',
    })

    await expect(
      reconcileAccount({
        accountId: card,
        actual: Money.fromMajor(12_217),
        expectedDifference: Money.fromMajor(-213),
        date: '2026-09-22',
        note: '',
      }),
    ).rejects.toThrow('изменился')

    expect(await db.transactions.where('type').equals('adjustment').count()).toBe(0)
  })

  it('отказывается от несуществующего счёта и от остатка вне пределов', async () => {
    await expect(
      reconcileAccount({ accountId: 'ghost', actual: 0, expectedDifference: 0, date: '2026-09-22', note: '' }),
    ).rejects.toThrow('не найден')
    await expect(
      reconcileAccount({ accountId: card, actual: Number.NaN, expectedDifference: 0, date: '2026-09-22', note: '' }),
    ).rejects.toThrow(RangeError)
  })
})
