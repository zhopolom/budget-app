import type { Category, CurrencyCode, Id, MinorUnits } from '../../types/entities'
import { Money } from '../../utils/money'
import { pluralRu } from '../../utils/plural'

/**
 * Применение бюджета к месяцу (ТЗ §36, §40): из шаблона или из другого месяца.
 * Чистый расчёт того, что изменится, — превью показывается до записи, а
 * запись повторяет ровно этот план. Молча заменять уже заданное нельзя.
 */

export interface SnapshotLimit {
  categoryId: Id
  limitAmount: MinorUnits
  /** Переносить остаток: при копировании месяца флаг едет вместе с лимитом. */
  rollover?: boolean
}

/** Бюджет месяца или шаблон в одном виде: общий лимит (0 — не задан) и лимиты категорий. */
export interface BudgetSnapshot {
  totalLimit: MinorUnits
  categoryLimits: SnapshotLimit[]
}

export type ApplyMode =
  /** Дополнить: заданное остаётся, добавляется недостающее. */
  | 'merge'
  /** Заменить: месяц становится точной копией источника. */
  | 'replace'

export interface ApplyPlan {
  mode: ApplyMode
  /** Общий лимит: с какого на какой. null — не меняется. */
  total: { from: MinorUnits; to: MinorUnits } | null
  /** Категории, у которых появится лимит. */
  added: SnapshotLimit[]
  /** Категории, у которых лимит станет другим (только replace). */
  changed: SnapshotLimit[]
  /** Лимиты, которые останутся как есть. */
  kept: Id[]
  /** Лимиты, которые будут сняты (только replace). */
  removed: Id[]
  /** Категории источника, которых больше нет: применить нечего. */
  skipped: Id[]
}

export function isSnapshotEmpty(snapshot: BudgetSnapshot): boolean {
  return snapshot.totalLimit === 0 && snapshot.categoryLimits.length === 0
}

export function planApplication(
  source: BudgetSnapshot,
  existing: BudgetSnapshot,
  mode: ApplyMode,
  knownCategories: ReadonlySet<Id>,
): ApplyPlan {
  const existingByCategory = new Map(existing.categoryLimits.map((limit) => [limit.categoryId, limit]))
  const plan: ApplyPlan = { mode, total: null, added: [], changed: [], kept: [], removed: [], skipped: [] }

  for (const limit of source.categoryLimits) {
    if (!knownCategories.has(limit.categoryId)) {
      plan.skipped.push(limit.categoryId)
      continue
    }
    const current = existingByCategory.get(limit.categoryId)
    if (!current) plan.added.push(limit)
    else if (mode === 'merge' || current.limitAmount === limit.limitAmount) plan.kept.push(limit.categoryId)
    else plan.changed.push(limit)
  }

  if (mode === 'replace') {
    const sourceCategories = new Set(source.categoryLimits.map((limit) => limit.categoryId))
    plan.removed = existing.categoryLimits
      .filter((limit) => !sourceCategories.has(limit.categoryId))
      .map((limit) => limit.categoryId)
    if (source.totalLimit !== existing.totalLimit) plan.total = { from: existing.totalLimit, to: source.totalLimit }
  } else if (existing.totalLimit === 0 && source.totalLimit > 0) {
    plan.total = { from: 0, to: source.totalLimit }
  }

  return plan
}

const limits = (count: number) => `${count} ${pluralRu(count, ['лимит', 'лимита', 'лимитов'])}`

/** Меняет ли план хоть что-то: одни «оставит как есть» — не изменение. */
export function isPlanEmpty(plan: ApplyPlan): boolean {
  return plan.total === null && plan.added.length === 0 && plan.changed.length === 0 && plan.removed.length === 0
}

/** Что план сделает — одной фразой для превью. Пустая строка — ничего не изменится. */
export function describePlan(plan: ApplyPlan, currency: CurrencyCode): string {
  if (isPlanEmpty(plan)) return ''
  const parts: string[] = []
  if (plan.total) {
    parts.push(
      plan.total.to === 0
        ? `снимет общий бюджет ${Money.format(plan.total.from, currency)}`
        : plan.total.from === 0
          ? `задаст общий бюджет ${Money.format(plan.total.to, currency)}`
          : `изменит общий бюджет с ${Money.format(plan.total.from, currency)} на ${Money.format(plan.total.to, currency)}`,
    )
  }
  if (plan.added.length > 0) parts.push(`добавит ${limits(plan.added.length)}`)
  if (plan.changed.length > 0) parts.push(`изменит ${limits(plan.changed.length)}`)
  if (plan.removed.length > 0) parts.push(`снимет ${limits(plan.removed.length)}`)
  if (plan.kept.length > 0) parts.push(`оставит ${limits(plan.kept.length)} как есть`)
  if (parts.length === 0) return ''
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Сколько категорий из источника уже не существует — для предупреждения. */
export function describeSkipped(plan: ApplyPlan, categories: readonly Category[]): string {
  if (plan.skipped.length === 0) return ''
  const known = new Set(categories.map((category) => category.id))
  const count = plan.skipped.filter((id) => !known.has(id)).length
  return count === 0 ? '' : `${limits(count)} на удалённые категории пропущено.`
}
