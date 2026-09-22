import type { CategoryBudget, MinorUnits } from '../../types/entities'
import { monthKey, previousMonth, type YearMonth } from '../../utils/dates'
import { Money } from '../../utils/money'

/**
 * Перенос неизрасходованного остатка лимита (ТЗ §37–§39).
 *
 * Хранится только флаг rollover у лимита месяца. Всё остальное — расчёт:
 *   effective(M) = base(M) + carry(M)
 *   carry(M)     = max(0, effective(M−1) − spent(M−1)), если у лимита M−1 включён перенос,
 *                  иначе 0.
 * Перерасход не переносится (ТЗ §38): отрицательный остаток даёт ноль, а не долг.
 * Цепочка идёт назад, пока предыдущий месяц имеет лимит с переносом, но не
 * глубже MAX_ROLLOVER_DEPTH: дальше история бюджета уже не влияет на сегодня.
 */

export const MAX_ROLLOVER_DEPTH = 24

export interface EffectiveLimit {
  /** Лимит, заданный на этот месяц. */
  baseLimit: MinorUnits
  /** Сколько пришло из прошлого месяца. */
  carry: MinorUnits
  /** baseLimit + carry — с этим сравниваются траты. */
  effectiveLimit: MinorUnits
}

/** История одной категории: лимиты и траты по месяцам, ключ — monthKey. */
export interface CategoryHistory {
  budgetsByMonth: ReadonlyMap<string, Pick<CategoryBudget, 'limitAmount' | 'rollover'>>
  spentByMonth: ReadonlyMap<string, MinorUnits>
}

/** Сколько переносится в month из предыдущего месяца. */
export function calculateCarry(month: YearMonth, history: CategoryHistory, depth = MAX_ROLLOVER_DEPTH): MinorUnits {
  if (depth <= 0) return 0
  const previous = previousMonth(month)
  const budget = history.budgetsByMonth.get(monthKey(previous))
  if (!budget || !budget.rollover) return 0

  const effective = Money.add(budget.limitAmount, calculateCarry(previous, history, depth - 1))
  const unused = Money.subtract(effective, history.spentByMonth.get(monthKey(previous)) ?? 0)
  return Math.max(0, unused)
}

export function calculateEffectiveLimit(
  month: YearMonth,
  budget: Pick<CategoryBudget, 'limitAmount'>,
  history: CategoryHistory,
): EffectiveLimit {
  const carry = calculateCarry(month, history)
  return { baseLimit: budget.limitAmount, carry, effectiveLimit: Money.add(budget.limitAmount, carry) }
}

/**
 * Самый ранний месяц, который ещё влияет на перенос в month: цепочка лимитов
 * с переносом назад от предыдущего месяца. null — переносить нечего.
 * По нему грузятся операции: читать историю за все годы ради одного лимита не нужно.
 */
export function rolloverChainStart(
  month: YearMonth,
  budgetsByMonth: ReadonlyMap<string, Pick<CategoryBudget, 'rollover'>>,
  depth = MAX_ROLLOVER_DEPTH,
): YearMonth | null {
  let start: YearMonth | null = null
  let cursor = previousMonth(month)
  for (let step = 0; step < depth; step += 1) {
    const budget = budgetsByMonth.get(monthKey(cursor))
    if (!budget?.rollover) break
    start = cursor
    cursor = previousMonth(cursor)
  }
  return start
}
