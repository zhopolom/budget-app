import { describe, expect, it } from 'vitest'
import type { Category, CategoryBudget } from '../../types/entities'
import { Money } from '../../utils/money'
import { buildCategoryBudgetProgress, calculateBudgetProgress, totalCategoryLimits } from './calculations'
import { categoryBudgetIdFor } from './ids'

const MONTH = { year: 2026, month: 9 }

const category = (id: string, name: string): Category => ({
  id,
  name,
  icon: '🛒',
  type: 'expense',
  isSystem: true,
  createdAt: 1,
})

const CATEGORIES = [category('groceries', 'Продукты'), category('transport', 'Транспорт'), category('fun', 'Развлечения')]

const limit = (categoryId: string, amount: number): CategoryBudget => ({
  id: categoryBudgetIdFor(MONTH, categoryId),
  categoryId,
  year: MONTH.year,
  month: MONTH.month,
  limitAmount: Money.fromMajor(amount),
  createdAt: 1,
  updatedAt: 1,
})

describe('calculateBudgetProgress', () => {
  it('считает остаток, процент и оставшиеся дни текущего месяца', () => {
    const progress = calculateBudgetProgress(
      Money.fromMajor(15_000),
      Money.fromMajor(8_420),
      MONTH,
      new Date(2026, 8, 21),
    )

    expect(progress.remaining).toBe(Money.fromMajor(6_580))
    expect(progress.percent).toBe(56)
    expect(progress.isOver).toBe(false)
    expect(progress.tone).toBe('normal')
    expect(progress.daysLeft).toBe(10)
  })

  it('за 10% до лимита предупреждает, за лимитом — краснеет', () => {
    const near = calculateBudgetProgress(Money.fromMajor(1_000), Money.fromMajor(950), MONTH, new Date(2026, 8, 21))
    expect(near.tone).toBe('warning')
    expect(near.isOver).toBe(false)

    const over = calculateBudgetProgress(Money.fromMajor(1_000), Money.fromMajor(1_200), MONTH, new Date(2026, 8, 21))
    expect(over.tone).toBe('danger')
    expect(over.isOver).toBe(true)
    expect(over.remaining).toBe(Money.fromMajor(-200))
    expect(over.percent).toBe(120)
  })

  it('для чужого месяца дней не считает', () => {
    const progress = calculateBudgetProgress(Money.fromMajor(100), 0, MONTH, new Date(2026, 9, 5))
    expect(progress.daysLeft).toBeNull()
  })
})

describe('buildCategoryBudgetProgress', () => {
  const spent = new Map([
    ['groceries', Money.fromMajor(3_420)],
    ['transport', Money.fromMajor(1_850)],
    ['fun', Money.fromMajor(6_200)],
  ])

  it('считает прогресс по каждому лимиту', () => {
    const [first] = buildCategoryBudgetProgress([limit('groceries', 5_000)], spent, CATEGORIES)

    expect(first.category.name).toBe('Продукты')
    expect(first.spent).toBe(Money.fromMajor(3_420))
    expect(first.limit).toBe(Money.fromMajor(5_000))
    expect(first.remaining).toBe(Money.fromMajor(1_580))
    expect(first.percent).toBe(68)
    expect(first.isOver).toBe(false)
  })

  it('перенос из прошлого месяца добавляется к лимиту, но виден отдельно', () => {
    const [row] = buildCategoryBudgetProgress(
      [limit('groceries', 6_000)],
      new Map([['groceries', Money.fromMajor(6_500)]]),
      CATEGORIES,
      new Map([['groceries', Money.fromMajor(800)]]),
    )

    expect(row.baseLimit).toBe(Money.fromMajor(6_000))
    expect(row.carry).toBe(Money.fromMajor(800))
    expect(row.limit).toBe(Money.fromMajor(6_800))
    expect(row.remaining).toBe(Money.fromMajor(300))
    expect(row.isOver).toBe(false)
  })

  it('показывает превышение отрицательным остатком', () => {
    const [over] = buildCategoryBudgetProgress([limit('fun', 5_000)], spent, CATEGORIES)

    expect(over.isOver).toBe(true)
    expect(over.remaining).toBe(Money.fromMajor(-1_200))
    expect(over.percent).toBe(124)
    expect(over.tone).toBe('danger')
  })

  it('сначала показывает категории, где лимит ближе к концу', () => {
    const rows = buildCategoryBudgetProgress(
      [limit('groceries', 5_000), limit('transport', 2_000), limit('fun', 5_000)],
      spent,
      CATEGORIES,
    )

    expect(rows.map((row) => row.category.id)).toEqual(['fun', 'transport', 'groceries'])
  })

  it('при равном проценте сохраняет порядок категорий', () => {
    const rows = buildCategoryBudgetProgress(
      [limit('transport', 1_000), limit('groceries', 1_000)],
      new Map([
        ['groceries', Money.fromMajor(500)],
        ['transport', Money.fromMajor(500)],
      ]),
      CATEGORIES,
    )

    expect(rows.map((row) => row.category.id)).toEqual(['groceries', 'transport'])
  })

  it('без трат показывает полный остаток', () => {
    const [row] = buildCategoryBudgetProgress([limit('groceries', 5_000)], new Map(), CATEGORIES)
    expect(row.spent).toBe(0)
    expect(row.remaining).toBe(Money.fromMajor(5_000))
    expect(row.percent).toBe(0)
  })

  it('пропускает лимиты удалённых категорий', () => {
    const rows = buildCategoryBudgetProgress([limit('ghost', 1_000), limit('groceries', 5_000)], spent, CATEGORIES)
    expect(rows).toHaveLength(1)
    expect(rows[0].category.id).toBe('groceries')
  })
})

describe('totalCategoryLimits', () => {
  it('складывает лимиты месяца', () => {
    expect(totalCategoryLimits([limit('groceries', 5_000), limit('transport', 2_000)])).toBe(Money.fromMajor(7_000))
    expect(totalCategoryLimits([])).toBe(0)
  })
})

describe('categoryBudgetIdFor', () => {
  it('даёт детерминированный ключ: повторная запись перезапишет ту же строку', () => {
    expect(categoryBudgetIdFor({ year: 2026, month: 9 }, 'groceries')).toBe('2026-09:groceries')
    expect(categoryBudgetIdFor({ year: 2026, month: 12 }, 'groceries')).toBe('2026-12:groceries')
  })
})
