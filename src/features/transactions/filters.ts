import type { Id, IsoDate, MinorUnits, TransactionType } from '../../types/entities'
import { monthDateRange, shiftMonth, type YearMonth } from '../../utils/dates'
import { isTransfer } from './model'
import type { TransactionView } from './views'

/** Период, за который экран вообще читает операции. */
export type PeriodPreset = 'month' | 'quarter' | 'year' | 'all' | 'custom'

export interface TransactionFilters {
  /** Пустой массив — все типы. */
  types: TransactionType[]
  /** Пустой массив — все счета. */
  accountIds: Id[]
  /** Пустой массив — все категории. */
  categoryIds: Id[]
  period: PeriodPreset
  /** Только для period = 'custom'. */
  from: IsoDate | null
  to: IsoDate | null
  minAmount: MinorUnits | null
  maxAmount: MinorUnits | null
}

export const EMPTY_FILTERS: TransactionFilters = {
  types: [],
  accountIds: [],
  categoryIds: [],
  period: 'month',
  from: null,
  to: null,
  minAmount: null,
  maxAmount: null,
}

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  month: 'Месяц',
  quarter: '3 месяца',
  year: 'Год',
  all: 'Всё время',
  custom: 'Свой период',
}

/** Границы выборки. null — читаем всю историю. */
export interface DateRange {
  start: IsoDate
  end: IsoDate
}

/**
 * Во что превращается выбранный период. Месяц берётся из общего MonthSelector,
 * поэтому «3 месяца» — это выбранный месяц и два перед ним.
 */
export function resolvePeriod(filters: TransactionFilters, month: YearMonth): DateRange | null {
  switch (filters.period) {
    case 'month':
      return monthDateRange(month)
    case 'quarter':
      return { start: monthDateRange(shiftMonth(month, -2)).start, end: monthDateRange(month).end }
    case 'year':
      return { start: monthDateRange(shiftMonth(month, -11)).start, end: monthDateRange(month).end }
    case 'all':
      return null
    case 'custom': {
      // Незаполненный край не ограничивает выборку
      if (!filters.from && !filters.to) return null
      return { start: filters.from ?? '0000-01-01', end: filters.to ?? '9999-12-31' }
    }
  }
}

/** Сколько фильтров реально что-то ограничивают — для подписи «Фильтры (3)». */
export function countActiveFilters(filters: TransactionFilters): number {
  let count = 0
  if (filters.types.length > 0) count += 1
  if (filters.accountIds.length > 0) count += 1
  if (filters.categoryIds.length > 0) count += 1
  if (filters.period !== 'month') count += 1
  if (filters.minAmount !== null) count += 1
  if (filters.maxAmount !== null) count += 1
  return count
}

/** Приводит строку к виду, по которому сравниваем: регистр и ё не должны мешать. */
export function normalizeSearch(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, 'е')
}

/** Поиск идёт по комментарию, названию категории и названиям счетов. */
export function matchesQuery(view: TransactionView, query: string): boolean {
  if (query === '') return true

  const haystack = [
    view.transaction.note,
    view.category?.name,
    view.account?.name,
    view.fromAccount?.name,
    view.toAccount?.name,
  ]

  return haystack.some((value) => value !== undefined && normalizeSearch(value).includes(query))
}

function matchesFilters(view: TransactionView, filters: TransactionFilters): boolean {
  const { transaction } = view

  if (filters.types.length > 0 && !filters.types.includes(transaction.type)) return false

  if (filters.accountIds.length > 0) {
    const ids = isTransfer(transaction)
      ? [transaction.fromAccountId, transaction.toAccountId]
      : [transaction.accountId]
    if (!ids.some((id) => filters.accountIds.includes(id))) return false
  }

  if (filters.categoryIds.length > 0) {
    // У перевода категории нет — фильтр по категории его исключает
    if (isTransfer(transaction) || !filters.categoryIds.includes(transaction.categoryId)) return false
  }

  if (filters.minAmount !== null && transaction.amount < filters.minAmount) return false
  if (filters.maxAmount !== null && transaction.amount > filters.maxAmount) return false

  if (filters.period === 'custom') {
    if (filters.from && transaction.date < filters.from) return false
    if (filters.to && transaction.date > filters.to) return false
  }

  return true
}

export function applyFilters(
  views: readonly TransactionView[],
  filters: TransactionFilters,
  query: string,
): TransactionView[] {
  const normalized = normalizeSearch(query)
  return views.filter((view) => matchesFilters(view, filters) && matchesQuery(view, normalized))
}
