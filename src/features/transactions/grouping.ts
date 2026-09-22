import type { IsoDate, MinorUnits } from '../../types/entities'
import { Money } from '../../utils/money'
import { compareNewestFirst } from './calculations'
import { isEntry, isTransfer } from './model'
import type { TransactionView } from './views'

export interface DayGroup {
  date: IsoDate
  items: TransactionView[]
  /** Расходы дня: то, что интересно видеть в заголовке. Переводы не считаются. */
  expense: MinorUnits
  income: MinorUnits
}

/**
 * Группировка по дням, новые сверху. Один проход по уже отсортированному
 * списку: отдельных запросов к базе за каждый день не делаем.
 */
export function groupByDay(views: readonly TransactionView[]): DayGroup[] {
  const sorted = [...views].sort((a, b) => compareNewestFirst(a.transaction, b.transaction))
  const groups: DayGroup[] = []
  let current: DayGroup | null = null

  for (const view of sorted) {
    const { transaction } = view
    if (!current || current.date !== transaction.date) {
      current = { date: transaction.date, items: [], expense: 0, income: 0 }
      groups.push(current)
    }
    current.items.push(view)

    // Переводы и корректировки в итогах дня не участвуют
    if (!isEntry(transaction)) continue
    if (transaction.type === 'expense') current.expense = Money.add(current.expense, transaction.amount)
    else current.income = Money.add(current.income, transaction.amount)
  }

  return groups
}

/** Сумма расходов по каждому дню — для календаря. */
export function dailyExpenses(views: readonly TransactionView[]): Map<IsoDate, MinorUnits> {
  const totals = new Map<IsoDate, MinorUnits>()
  for (const { transaction } of views) {
    if (isTransfer(transaction) || transaction.type !== 'expense') continue
    totals.set(transaction.date, Money.add(totals.get(transaction.date) ?? 0, transaction.amount))
  }
  return totals
}
