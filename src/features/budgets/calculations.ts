import type { MinorUnits } from '../../types/entities'
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
    tone: isOver ? 'danger' : ratio >= WARNING_RATIO ? 'warning' : 'normal',
    daysLeft: isCurrentMonth ? daysInMonth(month) - today.getDate() + 1 : null,
  }
}
