import { describe, expect, it } from 'vitest'
import {
  compareYearMonth,
  daysInMonth,
  formatDayLabel,
  fromMonthKey,
  isSameYearMonth,
  isValidIsoDate,
  monthDateRange,
  monthKey,
  previousMonth,
  shiftMonth,
  toIsoDate,
  yearMonthOf,
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
