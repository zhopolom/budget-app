import { describe, expect, it } from 'vitest'
import type { Account, SavingsGoal } from '../../types/entities'
import { Money } from '../../utils/money'
import {
  buildGoalProgress,
  calculateMonthlyRequired,
  calculateMonthsRemaining,
  calculateProgress,
  calculateRemaining,
  calculateTargetStatus,
} from './service'

const TODAY = '2026-09-22'

const SAVINGS: Account = {
  id: 'acc-savings',
  name: 'Накопительный',
  type: 'savings',
  initialBalance: 0,
  currency: 'UAH',
  createdAt: 1,
  updatedAt: 1,
}

function goal(patch: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: 'goal-1',
    name: 'MacBook',
    icon: '💻',
    targetAmount: Money.fromMajor(80_000),
    targetDate: '2026-12-31',
    linkedAccountId: SAVINGS.id,
    isArchived: false,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

describe('calculateProgress', () => {
  it('42 000 из 80 000 — это 52 %, а не 53: проценты вниз', () => {
    expect(calculateProgress(Money.fromMajor(42_000), Money.fromMajor(80_000))).toEqual({ ratio: 0.525, percent: 52 })
  })

  it('не делит на ноль и не уходит за 100 %', () => {
    expect(calculateProgress(Money.fromMajor(100), 0)).toEqual({ ratio: 0, percent: 0 })
    expect(calculateProgress(Money.fromMajor(90_000), Money.fromMajor(80_000))).toEqual({ ratio: 1, percent: 100 })
    expect(calculateProgress(-Money.fromMajor(500), Money.fromMajor(80_000))).toEqual({ ratio: 0, percent: 0 })
  })
})

describe('calculateRemaining', () => {
  it('остаток не бывает отрицательным', () => {
    expect(calculateRemaining(Money.fromMajor(42_000), Money.fromMajor(80_000))).toBe(Money.fromMajor(38_000))
    expect(calculateRemaining(Money.fromMajor(90_000), Money.fromMajor(80_000))).toBe(0)
  })
})

describe('calculateMonthsRemaining', () => {
  it('считает месяцы до срока, включая текущий', () => {
    expect(calculateMonthsRemaining('2026-12-31', TODAY)).toBe(4)
    expect(calculateMonthsRemaining('2026-09-30', TODAY)).toBe(1)
    expect(calculateMonthsRemaining('2027-09-01', TODAY)).toBe(13)
  })

  it('прошедший срок — ноль месяцев', () => {
    expect(calculateMonthsRemaining('2026-09-21', TODAY)).toBe(0)
  })
})

describe('calculateMonthlyRequired', () => {
  it('делит остаток на месяцы и округляет вверх до целых', () => {
    // 38 000 / 4 = 9 500
    expect(calculateMonthlyRequired(Money.fromMajor(38_000), 4)).toBe(Money.fromMajor(9_500))
    // 10 000 / 3 = 3 333,33… → 3 334
    expect(calculateMonthlyRequired(Money.fromMajor(10_000), 3)).toBe(Money.fromMajor(3_334))
  })

  it('прошедший срок — весь остаток сразу, достигнутая цель — ноль', () => {
    expect(calculateMonthlyRequired(Money.fromMajor(38_000), 0)).toBe(Money.fromMajor(38_000))
    expect(calculateMonthlyRequired(0, 4)).toBe(0)
  })
})

describe('calculateTargetStatus', () => {
  it('достигнута, просрочена или копится', () => {
    expect(calculateTargetStatus(Money.fromMajor(80_000), Money.fromMajor(80_000), '2026-01-01', TODAY)).toBe('reached')
    expect(calculateTargetStatus(Money.fromMajor(10), Money.fromMajor(80_000), '2026-01-01', TODAY)).toBe('overdue')
    expect(calculateTargetStatus(Money.fromMajor(10), Money.fromMajor(80_000), '2026-12-31', TODAY)).toBe('active')
    expect(calculateTargetStatus(Money.fromMajor(10), Money.fromMajor(80_000), undefined, TODAY)).toBe('active')
  })
})

describe('buildGoalProgress', () => {
  it('цель со счётом считает прогресс по остатку счёта', () => {
    const balances = new Map([[SAVINGS.id, Money.fromMajor(42_000)]])
    const progress = buildGoalProgress(goal(), [SAVINGS], balances, TODAY)

    expect(progress).toMatchObject({
      account: SAVINGS,
      current: Money.fromMajor(42_000),
      remaining: Money.fromMajor(38_000),
      percent: 52,
      status: 'active',
      monthsRemaining: 4,
      requiredMonthly: Money.fromMajor(9_500),
    })
  })

  it('цель без счёта считает прогресс по накопленному вручную', () => {
    const progress = buildGoalProgress(
      goal({ linkedAccountId: undefined, currentAmount: Money.fromMajor(20_000), targetDate: undefined }),
      [SAVINGS],
      new Map(),
      TODAY,
    )
    expect(progress).toMatchObject({
      account: undefined,
      current: Money.fromMajor(20_000),
      percent: 25,
      monthsRemaining: null,
      requiredMonthly: null,
    })
  })

  it('цель с удалённым счётом не падает: прогресс ноль, счёта нет', () => {
    const progress = buildGoalProgress(goal({ linkedAccountId: 'acc-gone' }), [SAVINGS], new Map(), TODAY)
    expect(progress.account).toBeUndefined()
    expect(progress.current).toBe(0)
    expect(progress.percent).toBe(0)
  })

  it('прошедший срок: просрочена, взнос — весь остаток', () => {
    const balances = new Map([[SAVINGS.id, Money.fromMajor(42_000)]])
    const progress = buildGoalProgress(goal({ targetDate: '2026-08-31' }), [SAVINGS], balances, TODAY)
    expect(progress.status).toBe('overdue')
    expect(progress.monthsRemaining).toBe(0)
    expect(progress.requiredMonthly).toBe(Money.fromMajor(38_000))
  })

  it('достигнутая цель: 100 %, остаток ноль, взнос не нужен', () => {
    const balances = new Map([[SAVINGS.id, Money.fromMajor(85_000)]])
    const progress = buildGoalProgress(goal(), [SAVINGS], balances, TODAY)
    expect(progress).toMatchObject({ status: 'reached', percent: 100, remaining: 0, requiredMonthly: null })
  })
})
