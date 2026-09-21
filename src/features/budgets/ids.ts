import type { Id } from '../../types/entities'
import type { YearMonth } from '../../utils/dates'

/**
 * Детерминированные ключи бюджетов: один бюджет на месяц и один лимит на
 * пару «месяц + категория». Повторная запись перезаписывает запись, а не
 * создаёт вторую — это делает и миграцию, и импорт бэкапа идемпотентными.
 *
 * Модуль намеренно не импортирует db: им пользуются и репозитории, и миграции.
 */

const monthKey = ({ year, month }: YearMonth): string => `${year}-${String(month).padStart(2, '0')}`

/** '2026-09' */
export function budgetIdFor(ym: YearMonth): Id {
  return monthKey(ym)
}

/** '2026-09:cat-exp-groceries' */
export function categoryBudgetIdFor(ym: YearMonth, categoryId: Id): Id {
  return `${monthKey(ym)}:${categoryId}`
}
