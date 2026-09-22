import type { Account, IsoDate, MinorUnits, RecurringTransaction, Transaction } from '../../types/entities'
import { daysInMonth, monthDateRange, yearMonthOf } from '../../utils/dates'
import { Money } from '../../utils/money'
import { isSelfTransferRule } from '../recurring/model'
import { occurrencesBetween } from '../recurring/occurrences'
import { calculateTotalBalance, calculateTotals } from '../transactions/calculations'

/**
 * Прогноз (ТЗ §19–§22): что ждёт бюджет до конца месяца, если регулярные
 * операции сработают по расписанию. Чистые расчёты без базы и без Date.now():
 * на вход — ledger, расписания и бюджет, на выход — цифры для карточек.
 *
 * Прогноз ничего не создаёт. Настоящие операции появляются только когда
 * наступает дата (features/recurring/repository.ts), а здесь — ожидание.
 */

/** Ближайшие операции показываем на месяц вперёд. */
export const UPCOMING_DAYS = 30

/** Потолок вхождений одного расписания в прогнозе: ежедневное за месяц даёт 31. */
const MAX_OCCURRENCES_PER_RULE = 400

export interface UpcomingOccurrence {
  rule: RecurringTransaction
  date: IsoDate
}

/**
 * Будущие вхождения активных расписаний в [from; to] включительно, по дате.
 *
 * Отсчёт идёт от nextOccurrence, а не от начала расписания: всё, что раньше,
 * либо уже стало операцией, либо досоздастся при запуске — в обоих случаях
 * оно попадает в ledger, и считать его ещё раз значило бы удвоить.
 */
export function listUpcoming(
  rules: readonly RecurringTransaction[],
  from: IsoDate,
  to: IsoDate,
  limit = Number.POSITIVE_INFINITY,
): UpcomingOccurrence[] {
  const items: UpcomingOccurrence[] = []

  for (const rule of rules) {
    // Перевод «на себя» ничего не меняет, а выключенное расписание не сработает
    if (!rule.isActive || isSelfTransferRule(rule)) continue
    const start = rule.nextOccurrence > from ? rule.nextOccurrence : from
    for (const date of occurrencesBetween(rule, start, to, MAX_OCCURRENCES_PER_RULE)) {
      items.push({ rule, date })
    }
  }

  // В один день — в порядке создания расписаний, чтобы список не прыгал
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rule.createdAt - b.rule.createdAt))
  return items.slice(0, limit)
}

export interface DailyGuidance {
  /** limit − spent; отрицательное — лимит превышен. */
  remainingBudget: MinorUnits
  /** Дней до конца месяца, включая сегодня. */
  daysRemaining: number
  /**
   * Сколько можно тратить в день, чтобы уложиться: remaining / daysRemaining,
   * округлено вниз до целых единиц валюты. 0 — лимит уже исчерпан.
   */
  recommendedDailyBudget: MinorUnits
}

/** Ориентир на день по общему бюджету месяца (ТЗ §22). Считается только для текущего месяца. */
export function calculateDailyGuidance(limit: MinorUnits, spent: MinorUnits, today: IsoDate): DailyGuidance {
  const month = yearMonthOf(today)
  const daysRemaining = daysInMonth(month) - Number(today.slice(8, 10)) + 1
  const remainingBudget = Money.subtract(limit, spent)
  const perDay = remainingBudget > 0 ? Math.floor(remainingBudget / daysRemaining / 100) * 100 : 0

  return { remainingBudget, daysRemaining, recommendedDailyBudget: perDay }
}

export interface ForecastInput {
  today: IsoDate
  accounts: readonly Pick<Account, 'initialBalance'>[]
  /** Весь ledger: баланс считается по всей истории. */
  transactions: readonly Transaction[]
  rules: readonly RecurringTransaction[]
  /** Общий бюджет текущего месяца; null — не задан. */
  monthlyLimit: MinorUnits | null
}

export interface Forecast {
  today: IsoDate
  /** Последний день месяца — горизонт прогноза. */
  until: IsoDate
  /** Общий баланс сейчас — с корректировками, как на главной. */
  currentBalance: MinorUnits
  /** Регулярные доходы до конца месяца. */
  expectedIncome: MinorUnits
  /** Регулярные расходы до конца месяца. */
  expectedExpense: MinorUnits
  /** currentBalance + expectedIncome − expectedExpense. Переводы капитал не меняют и сюда не входят. */
  projectedBalance: MinorUnits
  /** Сколько регулярных доходов и расходов учтено. 0 — прогноз равен текущему балансу. */
  scheduledCount: number
  /** Ориентир по бюджету; null — общий бюджет месяца не задан. */
  guidance: DailyGuidance | null
}

/**
 * Прогноз до конца текущего месяца. Использует только ledger, расписания
 * и бюджет (ТЗ §20). Корректировки уже сидят в текущем балансе, а в ожидаемых
 * суммах их нет: сверка — не событие, которое повторяется по расписанию.
 */
export function calculateForecast({ today, accounts, transactions, rules, monthlyLimit }: ForecastInput): Forecast {
  const { start, end } = monthDateRange(yearMonthOf(today))

  let expectedIncome = 0
  let expectedExpense = 0
  let scheduledCount = 0
  for (const { rule } of listUpcoming(rules, today, end)) {
    if (rule.type === 'income') expectedIncome = Money.add(expectedIncome, rule.amount)
    else if (rule.type === 'expense') expectedExpense = Money.add(expectedExpense, rule.amount)
    else continue
    scheduledCount += 1
  }

  const currentBalance = calculateTotalBalance(accounts, transactions)
  const spent = calculateTotals(transactions.filter((item) => item.date >= start && item.date <= end)).expense

  return {
    today,
    until: end,
    currentBalance,
    expectedIncome,
    expectedExpense,
    projectedBalance: Money.subtract(Money.add(currentBalance, expectedIncome), expectedExpense),
    scheduledCount,
    guidance: monthlyLimit === null ? null : calculateDailyGuidance(monthlyLimit, spent, today),
  }
}
