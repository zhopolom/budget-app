import { differenceInCalendarMonths } from 'date-fns'
import type { Account, Id, IsoDate, MinorUnits, SavingsGoal } from '../../types/entities'
import { fromIsoDate } from '../../utils/dates'
import { Money } from '../../utils/money'

/**
 * Расчёты по целям накоплений (ТЗ §32). Чистые функции без базы и Date.now():
 * прогресс, остаток, сколько откладывать в месяц и в каком состоянии цель.
 *
 * Прогресс цели со счётом — остаток этого счёта: перевод на накопительный
 * счёт и есть пополнение цели, искусственных расходов нет (ТЗ §41).
 */

export type GoalStatus =
  /** Копится, срок не прошёл или не задан. */
  | 'active'
  /** Накоплено не меньше цели. */
  | 'reached'
  /** Срок прошёл, а цель не достигнута. */
  | 'overdue'

export interface GoalProgress {
  goal: SavingsGoal
  /** Связанный счёт. undefined — цель без счёта или счёт удалён. */
  account: Account | undefined
  current: MinorUnits
  target: MinorUnits
  /** Сколько ещё нужно; 0, когда цель достигнута. */
  remaining: MinorUnits
  /** 0…1. */
  ratio: number
  /** Целые проценты вниз: 100 % только когда цель достигнута. */
  percent: number
  status: GoalStatus
  /** Месяцев до срока, включая текущий. null — срока нет; 0 — срок прошёл. */
  monthsRemaining: number | null
  /** Сколько откладывать в месяц, чтобы успеть. null — срока нет или цель достигнута. */
  requiredMonthly: MinorUnits | null
}

/** Прогресс цели: остаток счёта или сумма, введённая вручную. */
export function goalCurrentAmount(goal: SavingsGoal, balances: ReadonlyMap<Id, MinorUnits>): MinorUnits {
  if (goal.linkedAccountId !== undefined) return balances.get(goal.linkedAccountId) ?? 0
  return goal.currentAmount ?? 0
}

/** Доля и проценты. Цель без суммы (0) считается пустой, а не бесконечной. */
export function calculateProgress(current: MinorUnits, target: MinorUnits): { ratio: number; percent: number } {
  if (target <= 0) return { ratio: 0, percent: 0 }
  const ratio = Math.min(Math.max(current / target, 0), 1)
  return { ratio, percent: Math.floor(ratio * 100) }
}

export function calculateRemaining(current: MinorUnits, target: MinorUnits): MinorUnits {
  return Math.max(0, Money.subtract(target, current))
}

/** Месяцев до срока, включая текущий: до декабря из сентября — четыре взноса. Прошедший срок — 0. */
export function calculateMonthsRemaining(targetDate: IsoDate, today: IsoDate): number {
  if (targetDate < today) return 0
  return differenceInCalendarMonths(fromIsoDate(targetDate), fromIsoDate(today)) + 1
}

/**
 * Взнос в месяц, округлённый вверх до целых единиц валюты. Если срок уже
 * прошёл, взнос — весь остаток: делить на ноль месяцев нечего.
 */
export function calculateMonthlyRequired(remaining: MinorUnits, monthsRemaining: number): MinorUnits {
  if (remaining <= 0) return 0
  if (monthsRemaining <= 0) return remaining
  return Math.ceil(remaining / monthsRemaining / 100) * 100
}

export function calculateTargetStatus(
  current: MinorUnits,
  target: MinorUnits,
  targetDate: IsoDate | undefined,
  today: IsoDate,
): GoalStatus {
  if (target > 0 && current >= target) return 'reached'
  if (targetDate !== undefined && targetDate < today) return 'overdue'
  return 'active'
}

export function buildGoalProgress(
  goal: SavingsGoal,
  accounts: readonly Account[],
  balances: ReadonlyMap<Id, MinorUnits>,
  today: IsoDate,
): GoalProgress {
  const account = goal.linkedAccountId === undefined ? undefined : accounts.find((item) => item.id === goal.linkedAccountId)
  const current = goalCurrentAmount(goal, balances)
  const target = goal.targetAmount
  const remaining = calculateRemaining(current, target)
  const status = calculateTargetStatus(current, target, goal.targetDate, today)
  const monthsRemaining = goal.targetDate === undefined ? null : calculateMonthsRemaining(goal.targetDate, today)

  return {
    goal,
    account,
    current,
    target,
    remaining,
    ...calculateProgress(current, target),
    status,
    monthsRemaining,
    requiredMonthly:
      monthsRemaining === null || status === 'reached' ? null : calculateMonthlyRequired(remaining, monthsRemaining),
  }
}

export function buildGoalsProgress(
  goals: readonly SavingsGoal[],
  accounts: readonly Account[],
  balances: ReadonlyMap<Id, MinorUnits>,
  today: IsoDate,
): GoalProgress[] {
  return goals.map((goal) => buildGoalProgress(goal, accounts, balances, today))
}
