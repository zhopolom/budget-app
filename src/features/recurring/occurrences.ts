import { addDays, addMonths, addYears, differenceInCalendarDays, differenceInCalendarMonths } from 'date-fns'
import type { IsoDate, RecurrenceFrequency } from '../../types/entities'
import { fromIsoDate, toIsoDate } from '../../utils/dates'
import { pluralRu } from '../../utils/plural'

/**
 * Расписание повторов. Чистая арифметика дат — без базы и без Date.now(),
 * поэтому полностью покрывается тестами.
 */
export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  /** Каждые N периодов, >= 1. */
  interval: number
  startDate: IsoDate
  /** Включительно. Отсутствует — бессрочно. */
  endDate?: IsoDate
}

/**
 * Сколько вхождений создаётся за один запуск приложения.
 *
 * Ежедневная операция, не открывавшаяся год, дала бы 365 записей за раз.
 * Лимит держит запуск быстрым; остаток досоздастся при следующем открытии,
 * потому что nextOccurrence остаётся в прошлом.
 */
export const MAX_OCCURRENCES_PER_RUN = 400

/**
 * Дата n-го вхождения, считая от startDate.
 *
 * Шаг всегда от начальной даты, а не от предыдущего вхождения: иначе
 * «31 января» превратилось бы в 28 февраля, потом в 28 марта и уехало бы
 * навсегда. С привязкой к началу получается 31 января → 28 февраля → 31 марта.
 */
export function occurrenceAt(rule: RecurrenceRule, index: number): IsoDate {
  const start = fromIsoDate(rule.startDate)
  const steps = index * rule.interval

  switch (rule.frequency) {
    case 'daily':
      return toIsoDate(addDays(start, steps))
    case 'weekly':
      return toIsoDate(addDays(start, steps * 7))
    case 'monthly':
      return toIsoDate(addMonths(start, steps))
    case 'yearly':
      return toIsoDate(addYears(start, steps))
  }
}

/**
 * Примерный номер вхождения на дату — чтобы не перебирать годы по одному дню.
 * Оценка может промахнуться на шаг, поэтому вызывающий код отступает назад.
 */
function estimateIndex(rule: RecurrenceRule, date: IsoDate): number {
  const start = fromIsoDate(rule.startDate)
  const target = fromIsoDate(date)

  switch (rule.frequency) {
    case 'daily':
      return Math.floor(differenceInCalendarDays(target, start) / rule.interval)
    case 'weekly':
      return Math.floor(differenceInCalendarDays(target, start) / (7 * rule.interval))
    case 'monthly':
      return Math.floor(differenceInCalendarMonths(target, start) / rule.interval)
    case 'yearly':
      return Math.floor(differenceInCalendarMonths(target, start) / (12 * rule.interval))
  }
}

/** Индекс, с которого точно не пропущено ни одного вхождения не раньше date. */
function safeStartIndex(rule: RecurrenceRule, date: IsoDate): number {
  let index = Math.max(0, estimateIndex(rule, date) - 1)
  // Отступаем, пока не окажемся строго раньше искомой даты или в самом начале
  while (index > 0 && occurrenceAt(rule, index) >= date) index -= 1
  return index
}

/** Шаг меньше одного периода зациклил бы перебор дат. */
function hasUsableInterval(rule: RecurrenceRule): boolean {
  return Number.isInteger(rule.interval) && rule.interval >= 1
}

/** Ближайшее вхождение не раньше указанной даты. null — расписание уже закончилось. */
export function nextOccurrenceOnOrAfter(rule: RecurrenceRule, date: IsoDate): IsoDate | null {
  if (!hasUsableInterval(rule)) return null
  const from = date < rule.startDate ? rule.startDate : date

  let index = safeStartIndex(rule, from)
  // Шагов немного: safeStartIndex уже подвёл вплотную
  for (let guard = 0; guard <= MAX_OCCURRENCES_PER_RUN; guard += 1) {
    const occurrence = occurrenceAt(rule, index)
    if (rule.endDate && occurrence > rule.endDate) return null
    if (occurrence >= from) return occurrence
    index += 1
  }
  return null
}

/**
 * Вхождения в промежутке [from; to] включительно, не больше limit штук.
 * Именно они превращаются в операции при запуске приложения.
 */
export function occurrencesBetween(
  rule: RecurrenceRule,
  from: IsoDate,
  to: IsoDate,
  limit: number = MAX_OCCURRENCES_PER_RUN,
): IsoDate[] {
  if (!hasUsableInterval(rule) || to < rule.startDate || from > to) return []

  const dates: IsoDate[] = []
  let index = safeStartIndex(rule, from < rule.startDate ? rule.startDate : from)

  while (dates.length < limit) {
    const occurrence = occurrenceAt(rule, index)
    if (occurrence > to) break
    if (rule.endDate && occurrence > rule.endDate) break
    if (occurrence >= from) dates.push(occurrence)
    index += 1
  }

  return dates
}

const FREQUENCY_FORMS: Record<RecurrenceFrequency, readonly [string, string, string]> = {
  daily: ['день', 'дня', 'дней'],
  weekly: ['неделю', 'недели', 'недель'],
  monthly: ['месяц', 'месяца', 'месяцев'],
  yearly: ['год', 'года', 'лет'],
}

const FREQUENCY_SIMPLE: Record<RecurrenceFrequency, string> = {
  daily: 'Ежедневно',
  weekly: 'Еженедельно',
  monthly: 'Ежемесячно',
  yearly: 'Ежегодно',
}

/** «Ежемесячно» или «Каждые 2 недели». */
export function describeRecurrence(frequency: RecurrenceFrequency, interval: number): string {
  if (interval <= 1) return FREQUENCY_SIMPLE[frequency]
  return `Каждые ${interval} ${pluralRu(interval, FREQUENCY_FORMS[frequency])}`
}
