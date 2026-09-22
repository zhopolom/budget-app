import { describe, expect, it } from 'vitest'
import {
  compareYearMonth,
  daysInMonth,
  formatDayLabel,
  fromMonthKey,
  isSameYearMonth,
  isValidIsoDate,
  isWeekend,
  formatFutureDay,
  monthDays,
  weekdayIndex,
  monthDateRange,
  monthKey,
  previousMonth,
  shiftMonth,
  toIsoDate,
  yearMonthOf,
  formatMonthAccusative,
  formatMonthDative,
  formatMonthGenitive,
  formatMonthPrepositional,
} from './dates'

describe('месяцы', () => {
  it('сдвигает месяц и пересчитывает год', () => {
    expect(shiftMonth({ year: 2026, month: 9 }, 1)).toEqual({ year: 2026, month: 10 })
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth({ year: 2026, month: 3 }, -14)).toEqual({ year: 2025, month: 1 })
    expect(shiftMonth({ year: 2026, month: 3 }, 22)).toEqual({ year: 2028, month: 1 })
  })

  it('previousMonth — это сдвиг на минус один', () => {
    expect(previousMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 })
  })

  it('ключ месяца обратим', () => {
    const ym = { year: 2026, month: 9 }
    expect(monthKey(ym)).toBe('2026-09')
    expect(fromMonthKey(monthKey(ym))).toEqual(ym)
  })

  it('достаёт месяц из даты операции без разбора Date', () => {
    expect(yearMonthOf('2026-09-21')).toEqual({ year: 2026, month: 9 })
    expect(yearMonthOf('2025-12-01')).toEqual({ year: 2025, month: 12 })
  })

  it('сравнивает месяцы', () => {
    expect(isSameYearMonth({ year: 2026, month: 9 }, { year: 2026, month: 9 })).toBe(true)
    expect(isSameYearMonth({ year: 2026, month: 9 }, { year: 2025, month: 9 })).toBe(false)
    expect(compareYearMonth({ year: 2026, month: 1 }, { year: 2026, month: 9 })).toBeLessThan(0)
    expect(compareYearMonth({ year: 2027, month: 1 }, { year: 2026, month: 9 })).toBeGreaterThan(0)
  })

  it('границы месяца включительно, с учётом високосного года', () => {
    expect(monthDateRange({ year: 2026, month: 9 })).toEqual({ start: '2026-09-01', end: '2026-09-30' })
    expect(monthDateRange({ year: 2024, month: 2 })).toEqual({ start: '2024-02-01', end: '2024-02-29' })
    expect(monthDateRange({ year: 2026, month: 2 })).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(daysInMonth({ year: 2024, month: 2 })).toBe(29)
  })
})

describe('даты', () => {
  it('проверяет формат и существование даты', () => {
    expect(isValidIsoDate('2026-09-21')).toBe(true)
    expect(isValidIsoDate('2026-02-31')).toBe(false)
    expect(isValidIsoDate('2026-9-1')).toBe(false)
    expect(isValidIsoDate('не дата')).toBe(false)
  })

  it('локальная дата не уезжает через часовой пояс', () => {
    expect(toIsoDate(new Date(2026, 8, 21))).toBe('2026-09-21')
  })

  it('подписывает сегодня и вчера словами', () => {
    expect(formatDayLabel('2026-09-21', '2026-09-21')).toBe('Сегодня')
    expect(formatDayLabel('2026-09-20', '2026-09-21')).toBe('Вчера')
    expect(formatDayLabel('2026-09-10', '2026-09-21')).toBe('10 сентября')
    expect(formatDayLabel('2025-09-10', '2026-09-21')).toBe('10 сентября 2025')
  })
})

describe('календарь', () => {
  it('неделя начинается с понедельника', () => {
    expect(weekdayIndex('2026-09-21')).toBe(0) // понедельник
    expect(weekdayIndex('2026-09-27')).toBe(6) // воскресенье
    expect(isWeekend('2026-09-26')).toBe(true)
    expect(isWeekend('2026-09-25')).toBe(false)
  })

  it('перечисляет все дни месяца', () => {
    const september = monthDays({ year: 2026, month: 9 })
    expect(september).toHaveLength(30)
    expect(september[0]).toBe('2026-09-01')
    expect(september.at(-1)).toBe('2026-09-30')
    expect(monthDays({ year: 2024, month: 2 })).toHaveLength(29)
  })

  it('дату в будущем подписывает отдельно от прошлой', () => {
    expect(formatFutureDay('2026-09-21', '2026-09-21')).toBe('Сегодня')
    expect(formatFutureDay('2026-09-22', '2026-09-21')).toBe('Завтра')
    expect(formatFutureDay('2026-10-14', '2026-09-21')).toBe('14 октября')
    expect(formatFutureDay('2027-01-05', '2026-09-21')).toBe('5 января 2027')
    expect(formatFutureDay('2026-09-20', '2026-09-21')).toBe('Вчера')
  })
})

describe('падежи названий месяцев', () => {
  const september = { year: 2026, month: 9 }
  const may = { year: 2026, month: 5 }

  it('«бюджет сентября», «за сентябрь», «к сентябрю», «в сентябре»', () => {
    expect(formatMonthGenitive(september)).toBe('сентября')
    expect(formatMonthAccusative(september)).toBe('сентябрь')
    expect(formatMonthDative(september)).toBe('сентябрю')
    expect(formatMonthPrepositional(september)).toBe('сентябре')
  })

  it('май склоняется как май', () => {
    expect(formatMonthAccusative(may)).toBe('май')
    expect(formatMonthDative(may)).toBe('маю')
    expect(formatMonthPrepositional(may)).toBe('мае')
  })
})
