import { db } from '../../db/database'
import type { Budget } from '../../types/entities'
import type { YearMonth } from '../../utils/dates'

export function budgetIdFor({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export const budgetsRepository = {
  getForMonth(ym: YearMonth): Promise<Budget | undefined> {
    return db.budgets.get(budgetIdFor(ym))
  },
}
