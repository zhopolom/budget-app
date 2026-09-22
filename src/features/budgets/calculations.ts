import type { Category, CategoryBudget, Id, MinorUnits } from '../../types/entities'
import { daysInMonth, type YearMonth } from '../../utils/dates'
import { Money } from '../../utils/money'

export type BudgetTone = 'normal' | 'warning' | 'danger'

export interface BudgetProgress {
  limit: MinorUnits
  spent: MinorUnits
  /** Может быть отрицательным, если лимит превышен. */
  remaining: MinorUnits
  /** spent / limit, может быть больше 1. */
  ratio: number
  percent: number
  isOver: boolean
  tone: BudgetTone
  /** Сколько дней месяца осталось, включая сегодня. null для прошлых и будущих месяцев. */
  daysLeft: number | null
}

const WARNING_RATIO = 0.9

/** Красный — только за превышением: жёлтый предупреждает, что лимит близко. */
function toneFor(ratio: number, isOver: boolean): BudgetTone {
  if (isOver) return 'danger'
  return ratio >= WARNING_RATIO ? 'warning' : 'normal'
}

export function calculateBudgetProgress(
  limit: MinorUnits,
  spent: MinorUnits,
  month: YearMonth,
  today: Date,
): BudgetProgress {
  const ratio = limit > 0 ? spent / limit : 0
  const isOver = spent > limit
  const isCurrentMonth = today.getFullYear() === month.year && today.getMonth() + 1 === month.month

  return {
    limit,
    spent,
    remaining: Money.subtract(limit, spent),
    ratio,
    percent: Money.percentOf(spent, limit),
    isOver,
    tone: toneFor(ratio, isOver),
    daysLeft: isCurrentMonth ? daysInMonth(month) - today.getDate() + 1 : null,
  }
}

export interface CategoryBudgetProgress {
  category: Category
  /** Лимит, с которым сравниваются траты: заданный плюс перенос. */
  limit: MinorUnits
  /** Лимит, заданный на месяц. */
  baseLimit: MinorUnits
  /** Перенос неизрасходованного остатка из прошлого месяца (0.5). */
  carry: MinorUnits
  spent: MinorUnits
  /** Отрицательное — лимит превышен на эту сумму. */
  remaining: MinorUnits
  ratio: number
  percent: number
  isOver: boolean
  tone: BudgetTone
}

/**
 * Прогресс по каждому заданному лимиту категории.
 *
 * Лимиты удалённых категорий пропускаются: строка без названия и иконки
 * ничего не сообщает, а сама запись остаётся в базе до чистки при удалении.
 *
 * Порядок — от самых «горящих» к спокойным: экран нужен, чтобы увидеть,
 * где кончаются деньги. При равном проценте сохраняется порядок категорий,
 * иначе строки прыгали бы после каждой операции.
 */
export function buildCategoryBudgetProgress(
  limits: readonly CategoryBudget[],
  spentByCategory: ReadonlyMap<Id, MinorUnits>,
  categories: readonly Category[],
  /** Перенос по категориям (rolloverData.ts); без него лимит равен заданному. */
  carries: ReadonlyMap<Id, MinorUnits> = new Map(),
): CategoryBudgetProgress[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const order = new Map(categories.map((category, index) => [category.id, index]))

  return limits
    .flatMap((budget) => {
      const category = categoryById.get(budget.categoryId)
      if (!category) return []

      const spent = spentByCategory.get(budget.categoryId) ?? 0
      const carry = carries.get(budget.categoryId) ?? 0
      const limit = Money.add(budget.limitAmount, carry)
      const ratio = limit > 0 ? spent / limit : 0
      const isOver = spent > limit

      return [
        {
          category,
          limit,
          baseLimit: budget.limitAmount,
          carry,
          spent,
          remaining: Money.subtract(limit, spent),
          ratio,
          percent: Money.percentOf(spent, limit),
          isOver,
          tone: toneFor(ratio, isOver),
        },
      ]
    })
    .sort((a, b) => b.ratio - a.ratio || (order.get(a.category.id) ?? 0) - (order.get(b.category.id) ?? 0))
}

/** Сумма всех лимитов категорий месяца — для подписи «задано лимитов на …». */
export function totalCategoryLimits(limits: readonly CategoryBudget[]): MinorUnits {
  return Money.sum(limits.map((limit) => limit.limitAmount))
}
