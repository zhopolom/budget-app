import { describe, expect, it } from 'vitest'
import { Money } from '../../utils/money'
import { calculateCarry, calculateEffectiveLimit, MAX_ROLLOVER_DEPTH, rolloverChainStart, type CategoryHistory } from './rollover'

const SEPTEMBER = { year: 2026, month: 9 }

function history(
  budgets: Record<string, { limit: number; rollover?: boolean }>,
  spent: Record<string, number> = {},
): CategoryHistory {
  return {
    budgetsByMonth: new Map(
      Object.entries(budgets).map(([key, value]) => [key, { limitAmount: Money.fromMajor(value.limit), rollover: value.rollover }]),
    ),
    spentByMonth: new Map(Object.entries(spent).map(([key, value]) => [key, Money.fromMajor(value)])),
  }
}

describe('calculateCarry', () => {
  it('переносит неизрасходованный остаток: 6 000 − 5 200 = 800', () => {
    const carry = calculateCarry(SEPTEMBER, history({ '2026-08': { limit: 6_000, rollover: true } }, { '2026-08': 5_200 }))
    expect(carry).toBe(Money.fromMajor(800))
  })

  it('без флага переноса — ноль, даже если остаток был', () => {
    expect(calculateCarry(SEPTEMBER, history({ '2026-08': { limit: 6_000 } }, { '2026-08': 5_200 }))).toBe(0)
    expect(calculateCarry(SEPTEMBER, history({ '2026-08': { limit: 6_000, rollover: false } }, { '2026-08': 0 }))).toBe(0)
  })

  it('без трат переносится весь лимит', () => {
    expect(calculateCarry(SEPTEMBER, history({ '2026-08': { limit: 6_000, rollover: true } }))).toBe(Money.fromMajor(6_000))
  })

  it('перерасход не переносится: ноль, а не долг', () => {
    expect(calculateCarry(SEPTEMBER, history({ '2026-08': { limit: 6_000, rollover: true } }, { '2026-08': 7_100 }))).toBe(0)
  })

  it('цепочка накапливается по месяцам', () => {
    // Июль: 6 000, потрачено 5 000 → в август 1 000; август: 6 000 + 1 000 = 7 000, потрачено 6 500 → в сентябрь 500
    const carry = calculateCarry(
      SEPTEMBER,
      history(
        { '2026-07': { limit: 6_000, rollover: true }, '2026-08': { limit: 6_000, rollover: true } },
        { '2026-07': 5_000, '2026-08': 6_500 },
      ),
    )
    expect(carry).toBe(Money.fromMajor(500))
  })

  it('цепочка рвётся на месяце без лимита или без переноса', () => {
    const noBudget = history({ '2026-06': { limit: 6_000, rollover: true }, '2026-08': { limit: 6_000, rollover: true } }, { '2026-08': 5_000 })
    expect(calculateCarry(SEPTEMBER, noBudget)).toBe(Money.fromMajor(1_000))

    const noFlag = history(
      { '2026-07': { limit: 6_000, rollover: true }, '2026-08': { limit: 6_000 } },
      { '2026-07': 0, '2026-08': 0 },
    )
    expect(calculateCarry(SEPTEMBER, noFlag)).toBe(0)
  })

  it('глубина ограничена: бесконечная история не считается вечно', () => {
    const budgets: Record<string, { limit: number; rollover: boolean }> = {}
    for (let index = 1; index <= 40; index += 1) {
      const date = new Date(2026, 8 - index, 1)
      budgets[`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`] = { limit: 100, rollover: true }
    }
    // Без трат каждый месяц добавляет 100: не больше MAX_ROLLOVER_DEPTH месяцев
    expect(calculateCarry(SEPTEMBER, history(budgets))).toBe(Money.fromMajor(100 * MAX_ROLLOVER_DEPTH))
  })
})

describe('calculateEffectiveLimit', () => {
  it('раскладывает лимит на базовый, перенос и итог, ничего не храня', () => {
    const effective = calculateEffectiveLimit(
      SEPTEMBER,
      { limitAmount: Money.fromMajor(6_000) },
      history({ '2026-08': { limit: 6_000, rollover: true } }, { '2026-08': 5_200 }),
    )
    expect(effective).toEqual({
      baseLimit: Money.fromMajor(6_000),
      carry: Money.fromMajor(800),
      effectiveLimit: Money.fromMajor(6_800),
    })
  })
})

describe('rolloverChainStart', () => {
  it('находит начало непрерывной цепочки переносов', () => {
    const budgets = history({
      '2026-05': { limit: 1, rollover: true },
      '2026-07': { limit: 1, rollover: true },
      '2026-08': { limit: 1, rollover: true },
    }).budgetsByMonth
    expect(rolloverChainStart(SEPTEMBER, budgets)).toEqual({ year: 2026, month: 7 })
  })

  it('без переноса в прошлом месяце начала нет', () => {
    expect(rolloverChainStart(SEPTEMBER, history({ '2026-08': { limit: 1 } }).budgetsByMonth)).toBeNull()
    expect(rolloverChainStart(SEPTEMBER, history({}).budgetsByMonth)).toBeNull()
  })
})
