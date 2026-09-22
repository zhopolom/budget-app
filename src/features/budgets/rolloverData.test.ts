import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import type { Id } from '../../types/entities'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { transactionsRepository } from '../transactions/repository'
import { categoryBudgetsRepository } from './repository'
import { loadEffectiveLimits } from './rolloverData'

const JULY = { year: 2026, month: 7 }
const AUGUST = { year: 2026, month: 8 }
const SEPTEMBER = { year: 2026, month: 9 }

const spend = (amount: number, date: string, categoryId: Id = C.groceries) =>
  transactionsRepository.create({
    type: 'expense',
    amount: Money.fromMajor(amount),
    categoryId,
    accountId: DEFAULT_ACCOUNT_IDS.card,
    date,
    note: '',
  })

const load = () => db.transaction('r', db.categoryBudgets, db.transactions, () => loadEffectiveLimits(SEPTEMBER))

beforeEach(resetTestDatabase)

describe('loadEffectiveLimits', () => {
  it('переносит остаток августа в сентябрь: 6 000 + 800', async () => {
    await categoryBudgetsRepository.set(AUGUST, C.groceries, Money.fromMajor(6_000), { rollover: true })
    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(6_000))
    await spend(5_200, '2026-08-14')
    // Траты сентября на перенос не влияют
    await spend(900, '2026-09-02')

    expect((await load()).get(C.groceries)).toEqual({
      baseLimit: Money.fromMajor(6_000),
      carry: Money.fromMajor(800),
      effectiveLimit: Money.fromMajor(6_800),
    })
  })

  it('без флага переноса, при перерасходе и без лимита в сентябре переносить нечего', async () => {
    await categoryBudgetsRepository.set(AUGUST, C.groceries, Money.fromMajor(6_000))
    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(6_000))
    await categoryBudgetsRepository.set(AUGUST, C.transport, Money.fromMajor(1_000), { rollover: true })
    await categoryBudgetsRepository.set(SEPTEMBER, C.transport, Money.fromMajor(1_000))
    await categoryBudgetsRepository.set(AUGUST, C.cafe, Money.fromMajor(500), { rollover: true })
    await spend(1_300, '2026-08-20', C.transport)

    const limits = await load()
    expect(limits.get(C.groceries)?.carry).toBe(0)
    expect(limits.get(C.transport)?.carry).toBe(0)
    // Лимита на сентябрь нет — категории в ответе нет
    expect(limits.has(C.cafe)).toBe(false)
  })

  it('цепочка из двух месяцев и нулевые траты', async () => {
    await categoryBudgetsRepository.set(JULY, C.groceries, Money.fromMajor(6_000), { rollover: true })
    await categoryBudgetsRepository.set(AUGUST, C.groceries, Money.fromMajor(6_000), { rollover: true })
    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(6_000))
    await spend(5_000, '2026-07-10')
    // В августе трат не было: переносится весь эффективный лимит 7 000

    expect((await load()).get(C.groceries)?.carry).toBe(Money.fromMajor(7_000))
  })
})
