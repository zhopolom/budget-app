import { describe, expect, it } from 'vitest'
import { Money } from '../../utils/money'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { describePlan, isSnapshotEmpty, planApplication, type BudgetSnapshot } from './apply'

const KNOWN = new Set([C.groceries, C.transport, C.entertainment, C.subscriptions])

/** «Обычный месяц» из ТЗ §35. */
const TEMPLATE: BudgetSnapshot = {
  totalLimit: Money.fromMajor(20_000),
  categoryLimits: [
    { categoryId: C.groceries, limitAmount: Money.fromMajor(6_000) },
    { categoryId: C.transport, limitAmount: Money.fromMajor(2_000) },
    { categoryId: C.entertainment, limitAmount: Money.fromMajor(3_000) },
    { categoryId: C.subscriptions, limitAmount: Money.fromMajor(1_000) },
  ],
}

const EMPTY: BudgetSnapshot = { totalLimit: 0, categoryLimits: [] }

const EXISTING: BudgetSnapshot = {
  totalLimit: Money.fromMajor(15_000),
  categoryLimits: [
    { categoryId: C.groceries, limitAmount: Money.fromMajor(5_000) },
    { categoryId: C.transport, limitAmount: Money.fromMajor(2_000) },
    { categoryId: 'cat-custom', limitAmount: Money.fromMajor(700), rollover: true },
  ],
}

describe('planApplication', () => {
  it('на пустой месяц ставит всё из источника', () => {
    const plan = planApplication(TEMPLATE, EMPTY, 'replace', KNOWN)
    expect(plan.total).toEqual({ from: 0, to: Money.fromMajor(20_000) })
    expect(plan.added).toHaveLength(4)
    expect(plan.changed).toEqual([])
    expect(plan.removed).toEqual([])
  })

  it('merge: заданное остаётся, добавляется недостающее, общий — только если не задан', () => {
    const plan = planApplication(TEMPLATE, EXISTING, 'merge', new Set([...KNOWN, 'cat-custom']))
    expect(plan.total).toBeNull()
    expect(plan.added.map((limit) => limit.categoryId)).toEqual([C.entertainment, C.subscriptions])
    expect(plan.kept).toEqual([C.groceries, C.transport])
    expect(plan.changed).toEqual([])
    expect(plan.removed).toEqual([])

    const withoutTotal = planApplication(TEMPLATE, { ...EXISTING, totalLimit: 0 }, 'merge', KNOWN)
    expect(withoutTotal.total).toEqual({ from: 0, to: Money.fromMajor(20_000) })
  })

  it('replace: месяц становится копией источника, лишнее снимается', () => {
    const plan = planApplication(TEMPLATE, EXISTING, 'replace', new Set([...KNOWN, 'cat-custom']))
    expect(plan.total).toEqual({ from: Money.fromMajor(15_000), to: Money.fromMajor(20_000) })
    expect(plan.changed.map((limit) => limit.categoryId)).toEqual([C.groceries])
    expect(plan.kept).toEqual([C.transport])
    expect(plan.added.map((limit) => limit.categoryId)).toEqual([C.entertainment, C.subscriptions])
    expect(plan.removed).toEqual(['cat-custom'])
  })

  it('источник без общего лимита в replace снимает общий бюджет месяца', () => {
    const plan = planApplication({ ...TEMPLATE, totalLimit: 0 }, EXISTING, 'replace', KNOWN)
    expect(plan.total).toEqual({ from: Money.fromMajor(15_000), to: 0 })
  })

  it('лимиты на удалённые категории пропускаются, а не ломают применение', () => {
    const plan = planApplication(TEMPLATE, EMPTY, 'replace', new Set([C.groceries]))
    expect(plan.added.map((limit) => limit.categoryId)).toEqual([C.groceries])
    expect(plan.skipped).toEqual([C.transport, C.entertainment, C.subscriptions])
  })

  it('одинаковый источник и месяц — план пустой', () => {
    const plan = planApplication(EXISTING, EXISTING, 'replace', new Set([...KNOWN, 'cat-custom']))
    expect(plan.total).toBeNull()
    expect(plan.added).toEqual([])
    expect(plan.changed).toEqual([])
    expect(plan.removed).toEqual([])
    expect(describePlan(plan, 'UAH')).toBe('')
  })
})

describe('describePlan', () => {
  it('называет каждое изменение', () => {
    const plan = planApplication(TEMPLATE, EXISTING, 'replace', new Set([...KNOWN, 'cat-custom']))
    // Суммы приходят с неразрывными пробелами — сравниваем без них
    expect(describePlan(plan, 'UAH').replace(/\u00A0/g, ' ')).toBe(
      'Изменит общий бюджет с 15 000 ₴ на 20 000 ₴, добавит 2 лимита, изменит 1 лимит, снимет 1 лимит, оставит 1 лимит как есть',
    )
  })
})

describe('isSnapshotEmpty', () => {
  it('пусто — только без общего лимита и без лимитов категорий', () => {
    expect(isSnapshotEmpty(EMPTY)).toBe(true)
    expect(isSnapshotEmpty({ totalLimit: 1, categoryLimits: [] })).toBe(false)
    expect(isSnapshotEmpty({ totalLimit: 0, categoryLimits: [{ categoryId: C.groceries, limitAmount: 1 }] })).toBe(false)
  })
})
