import { useSyncExternalStore } from 'react'
import type { IsoDate } from '../types/entities'
import { fromMonthKey, isSameYearMonth, monthKey, yearMonthOf, type YearMonth } from '../utils/dates'

/**
 * Выбранный месяц, общий для Главной, Операций, Календаря и Статистики:
 * пролистал сентябрь на одном экране — на соседнем открывается тот же сентябрь.
 *
 * Внутри лежит строка '2026-09' или null — «следовать за сегодняшним днём».
 * Строка, а не объект: useSyncExternalStore требует стабильный снимок,
 * новый объект на каждый вызов уводил бы React в бесконечный рендер.
 */

let selected: string | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): string | null {
  return selected
}

export function setSelectedMonth(ym: YearMonth | null): void {
  const next = ym ? monthKey(ym) : null
  if (next === selected) return
  selected = next
  listeners.forEach((listener) => listener())
}

/** Сбрасывает выбор: экраны снова показывают текущий месяц. */
export function resetSelectedMonth(): void {
  setSelectedMonth(null)
}

export interface SelectedMonth {
  month: YearMonth
  /** Совпадает ли выбранный месяц с сегодняшним. */
  isCurrent: boolean
  select: (ym: YearMonth) => void
  reset: () => void
}

export function useSelectedMonth(today: IsoDate): SelectedMonth {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const currentMonth = yearMonthOf(today)
  const month = stored ? fromMonthKey(stored) : currentMonth

  return {
    month,
    isCurrent: isSameYearMonth(month, currentMonth),
    select: (ym) => setSelectedMonth(isSameYearMonth(ym, currentMonth) ? null : ym),
    reset: resetSelectedMonth,
  }
}
