import { addDays, format, getDaysInMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { IsoDate } from '../types/entities'

export interface YearMonth {
  year: number
  /** 1–12 */
  month: number
}

const pad2 = (value: number) => String(value).padStart(2, '0')

export function toIsoDate(date: Date): IsoDate {
  return format(date, 'yyyy-MM-dd')
}

/** Разбирает 'yyyy-MM-dd' как локальную дату (new Date('2026-09-21') дал бы UTC). */
export function fromIsoDate(iso: IsoDate): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** Проверяет формат 'yyyy-MM-dd' и что такая дата существует (нет 31 февраля). */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return toIsoDate(fromIsoDate(value)) === value
}

/** Сдвиг календарной даты без разбора часовых поясов. */
export function addDaysIso(iso: IsoDate, days: number): IsoDate {
  return toIsoDate(addDays(fromIsoDate(iso), days))
}

export function toYearMonth(date: Date): YearMonth {
  return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

/** Месяц операции без разбора даты: '2026-09-21' → { year: 2026, month: 9 }. */
export function yearMonthOf(iso: IsoDate): YearMonth {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) }
}

/** '2026-09' — стабильный ключ месяца для Map, сортировки и хранения выбора. */
export function monthKey({ year, month }: YearMonth): string {
  return `${year}-${pad2(month)}`
}

export function fromMonthKey(key: string): YearMonth {
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) }
}

/** Сдвиг на N месяцев в любую сторону; год пересчитывается сам. */
export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const zeroBased = year * 12 + (month - 1) + delta
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 }
}

export function previousMonth(ym: YearMonth): YearMonth {
  return shiftMonth(ym, -1)
}

export function isSameYearMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month
}

export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a.year - b.year || a.month - b.month
}

function firstDayOf({ year, month }: YearMonth): Date {
  return new Date(year, month - 1, 1)
}

export function daysInMonth(ym: YearMonth): number {
  return getDaysInMonth(firstDayOf(ym))
}

/** Границы месяца включительно — строки сравниваются лексикографически. */
export function monthDateRange(ym: YearMonth): { start: IsoDate; end: IsoDate } {
  const prefix = `${ym.year}-${pad2(ym.month)}`
  return { start: `${prefix}-01`, end: `${prefix}-${pad2(daysInMonth(ym))}` }
}

/** Понедельник первый — как в русском календаре, а не как в getDay(). */
export const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const

/** 0 — понедельник, 6 — воскресенье. */
export function weekdayIndex(iso: IsoDate): number {
  return (fromIsoDate(iso).getDay() + 6) % 7
}

export function isWeekend(iso: IsoDate): boolean {
  return weekdayIndex(iso) >= 5
}

/** Все дни месяца строками 'yyyy-MM-dd'. */
export function monthDays(ym: YearMonth): IsoDate[] {
  const prefix = `${ym.year}-${pad2(ym.month)}`
  return Array.from({ length: daysInMonth(ym) }, (_, index) => `${prefix}-${pad2(index + 1)}`)
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** «Сентябрь 2026» */
export function formatMonthTitle(ym: YearMonth): string {
  return capitalize(format(firstDayOf(ym), 'LLLL yyyy', { locale: ru }))
}

/** «сентября» — для фраз вида «Бюджет сентября». */
export function formatMonthGenitive(ym: YearMonth): string {
  return format(firstDayOf(ym), 'MMMM', { locale: ru })
}

/**
 * Падежи, которых нет в date-fns: «за сентябрь» (винительный совпадает
 * с именительным), «к сентябрю», «в сентябре». Всё в нижнем регистре —
 * как внутри фразы.
 */
const MONTH_CASES = [
  ['январь', 'январю', 'январе'],
  ['февраль', 'февралю', 'феврале'],
  ['март', 'марту', 'марте'],
  ['апрель', 'апрелю', 'апреле'],
  ['май', 'маю', 'мае'],
  ['июнь', 'июню', 'июне'],
  ['июль', 'июлю', 'июле'],
  ['август', 'августу', 'августе'],
  ['сентябрь', 'сентябрю', 'сентябре'],
  ['октябрь', 'октябрю', 'октябре'],
  ['ноябрь', 'ноябрю', 'ноябре'],
  ['декабрь', 'декабрю', 'декабре'],
] as const

/** «сентябрь» — «за сентябрь», «лимит на сентябрь». */
export function formatMonthAccusative(ym: YearMonth): string {
  return MONTH_CASES[ym.month - 1][0]
}

/** «сентябрю» — «применить к сентябрю». */
export function formatMonthDative(ym: YearMonth): string {
  return MONTH_CASES[ym.month - 1][1]
}

/** «сентябре» — «в сентябре». */
export function formatMonthPrepositional(ym: YearMonth): string {
  return MONTH_CASES[ym.month - 1][2]
}

function dayDiff(iso: IsoDate, today: IsoDate): number {
  const msPerDay = 86_400_000
  // Через UTC, чтобы переход на летнее время не давал 23/25 часов
  const toUtc = (value: IsoDate) => {
    const [y, m, d] = value.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((toUtc(today) - toUtc(iso)) / msPerDay)
}

/** «Сегодня», «Вчера», «20 сентября», «20 сентября 2025». */
export function formatDayLabel(iso: IsoDate, today: IsoDate): string {
  const diff = dayDiff(iso, today)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Вчера'
  const date = fromIsoDate(iso)
  const sameYear = iso.slice(0, 4) === today.slice(0, 4)
  return format(date, sameYear ? 'd MMMM' : 'd MMMM yyyy', { locale: ru })
}

/** Для дат в будущем: «Сегодня», «Завтра», «14 октября», «14 октября 2027». */
export function formatFutureDay(iso: IsoDate, today: IsoDate): string {
  const diff = dayDiff(iso, today)
  if (diff === 0) return 'Сегодня'
  if (diff === -1) return 'Завтра'
  if (diff > 0) return formatDayLabel(iso, today)
  const sameYear = iso.slice(0, 4) === today.slice(0, 4)
  return format(fromIsoDate(iso), sameYear ? 'd MMMM' : 'd MMMM yyyy', { locale: ru })
}

/** Короткий вариант для строк списка: «Сегодня», «Вчера», «20 сент.». */
export function formatDayShort(iso: IsoDate, today: IsoDate): string {
  const diff = dayDiff(iso, today)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Вчера'
  const sameYear = iso.slice(0, 4) === today.slice(0, 4)
  return format(fromIsoDate(iso), sameYear ? 'd MMM' : 'd MMM yyyy', { locale: ru })
}
