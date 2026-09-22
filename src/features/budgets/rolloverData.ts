import { db } from '../../db/database'
import type { CategoryBudget, Id, MinorUnits } from '../../types/entities'
import { monthDateRange, monthKey, previousMonth, shiftMonth, yearMonthOf, type YearMonth } from '../../utils/dates'
import { Money } from '../../utils/money'
import { isEntry } from '../transactions/model'
import { calculateEffectiveLimit, MAX_ROLLOVER_DEPTH, rolloverChainStart, type EffectiveLimit } from './rollover'

/**
 * Перенос остатка для всех лимитов месяца — из базы, но с минимумом чтений:
 * лимиты берутся одним запросом по индексу [year+month] за окно глубины
 * переноса, а операции — только за месяцы, которые действительно входят
 * в цепочку, и только если хоть у одной категории она есть.
 *
 * Вызывать внутри транзакции над categoryBudgets и transactions.
 */
export async function loadEffectiveLimits(month: YearMonth): Promise<Map<Id, EffectiveLimit>> {
  const windowStart = shiftMonth(month, -MAX_ROLLOVER_DEPTH)
  const budgets = (await db.categoryBudgets
    .where('[year+month]')
    .between([windowStart.year, windowStart.month], [month.year, month.month], true, true)
    .toArray()) as CategoryBudget[]

  const byCategory = new Map<Id, Map<string, CategoryBudget>>()
  for (const budget of budgets) {
    const months = byCategory.get(budget.categoryId) ?? new Map<string, CategoryBudget>()
    months.set(monthKey({ year: budget.year, month: budget.month }), budget)
    byCategory.set(budget.categoryId, months)
  }

  // Самое раннее начало цепочки среди категорий с лимитом в этом месяце
  const current = monthKey(month)
  let earliest: YearMonth | null = null
  for (const [, months] of byCategory) {
    if (!months.has(current)) continue
    const start = rolloverChainStart(month, months)
    if (start && (!earliest || monthKey(start) < monthKey(earliest))) earliest = start
  }

  // Траты по месяцам нужны только когда есть что переносить
  const spentByCategory = new Map<Id, Map<string, MinorUnits>>()
  if (earliest) {
    const from = monthDateRange(earliest).start
    const to = monthDateRange(previousMonth(month)).end
    const transactions = await db.transactions.where('date').between(from, to, true, true).toArray()
    for (const transaction of transactions) {
      if (!isEntry(transaction) || transaction.type !== 'expense') continue
      const months = spentByCategory.get(transaction.categoryId) ?? new Map<string, MinorUnits>()
      const key = monthKey(yearMonthOf(transaction.date))
      months.set(key, Money.add(months.get(key) ?? 0, transaction.amount))
      spentByCategory.set(transaction.categoryId, months)
    }
  }

  const result = new Map<Id, EffectiveLimit>()
  for (const [categoryId, months] of byCategory) {
    const budget = months.get(current)
    if (!budget) continue
    result.set(
      categoryId,
      calculateEffectiveLimit(month, budget, {
        budgetsByMonth: months,
        spentByMonth: spentByCategory.get(categoryId) ?? new Map(),
      }),
    )
  }
  return result
}
