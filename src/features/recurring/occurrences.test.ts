import { describe, expect, it } from 'vitest'
import {
  describeRecurrence,
  MAX_OCCURRENCES_PER_RUN,
  nextOccurrenceOnOrAfter,
  occurrenceAt,
  occurrencesBetween,
  type RecurrenceRule,
} from './occurrences'

const monthly = (startDate: string, interval = 1, endDate?: string): RecurrenceRule => ({
  frequency: 'monthly',
  interval,
  startDate,
  endDate,
})

describe('occurrenceAt', () => {
  it('ежедневно с интервалом', () => {
    const rule: RecurrenceRule = { frequency: 'daily', interval: 3, startDate: '2026-09-01' }
    expect([0, 1, 2].map((n) => occurrenceAt(rule, n))).toEqual(['2026-09-01', '2026-09-04', '2026-09-07'])
  })

  it('еженедельно', () => {
    const rule: RecurrenceRule = { frequency: 'weekly', interval: 2, startDate: '2026-09-01' }
    expect([0, 1, 2].map((n) => occurrenceAt(rule, n))).toEqual(['2026-09-01', '2026-09-15', '2026-09-29'])
  })

  it('ежемесячно', () => {
    expect([0, 1, 2].map((n) => occurrenceAt(monthly('2026-09-14'), n))).toEqual([
      '2026-09-14',
      '2026-10-14',
      '2026-11-14',
    ])
  })

  it('через год месяцы не сбиваются', () => {
    expect(occurrenceAt(monthly('2026-11-05'), 3)).toBe('2027-02-05')
  })

  it('ежегодно, 29 февраля не теряется в следующем високосном', () => {
    const rule: RecurrenceRule = { frequency: 'yearly', interval: 1, startDate: '2024-02-29' }
    expect([0, 1, 4].map((n) => occurrenceAt(rule, n))).toEqual(['2024-02-29', '2025-02-28', '2028-02-29'])
  })

  it('31-е число не уезжает: шаг считается от начала, а не от прошлого вхождения', () => {
    const rule = monthly('2026-01-31')
    expect([0, 1, 2, 3].map((n) => occurrenceAt(rule, n))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })
})

describe('occurrencesBetween', () => {
  it('отдаёт все пропущенные месяцы разом', () => {
    // Пользователь не открывал приложение с июля
    expect(occurrencesBetween(monthly('2026-07-14'), '2026-07-14', '2026-09-21')).toEqual([
      '2026-07-14',
      '2026-08-14',
      '2026-09-14',
    ])
  })

  it('не выходит за дату окончания', () => {
    expect(occurrencesBetween(monthly('2026-07-14', 1, '2026-08-20'), '2026-07-14', '2026-12-31')).toEqual([
      '2026-07-14',
      '2026-08-14',
    ])
  })

  it('не создаёт вхождений раньше начала расписания', () => {
    expect(occurrencesBetween(monthly('2026-09-14'), '2026-01-01', '2026-09-21')).toEqual(['2026-09-14'])
  })

  it('пусто, если период раньше начала', () => {
    expect(occurrencesBetween(monthly('2026-09-14'), '2026-01-01', '2026-08-31')).toEqual([])
  })

  it('пусто, если вхождение ещё не наступило', () => {
    expect(occurrencesBetween(monthly('2026-09-14'), '2026-10-14', '2026-09-21')).toEqual([])
  })

  it('уважает limit, чтобы запуск не вставал на годовой истории', () => {
    const rule: RecurrenceRule = { frequency: 'daily', interval: 1, startDate: '2020-01-01' }
    const dates = occurrencesBetween(rule, '2020-01-01', '2026-09-21')
    expect(dates).toHaveLength(MAX_OCCURRENCES_PER_RUN)
    expect(dates[0]).toBe('2020-01-01')

    // Остаток доберётся следующим запуском — счёт продолжается с того же места
    const next = occurrencesBetween(rule, '2021-02-05', '2026-09-21', 3)
    expect(next).toEqual(['2021-02-05', '2021-02-06', '2021-02-07'])
  })

  it('не зацикливается на испорченном интервале', () => {
    expect(occurrencesBetween({ frequency: 'daily', interval: 0, startDate: '2026-01-01' }, '2026-01-01', '2026-09-21')).toEqual([])
    expect(occurrencesBetween({ frequency: 'daily', interval: -3, startDate: '2026-01-01' }, '2026-01-01', '2026-09-21')).toEqual([])
  })
})

describe('nextOccurrenceOnOrAfter', () => {
  it('находит ближайшее вхождение', () => {
    expect(nextOccurrenceOnOrAfter(monthly('2026-01-14'), '2026-09-15')).toBe('2026-10-14')
    expect(nextOccurrenceOnOrAfter(monthly('2026-01-14'), '2026-09-14')).toBe('2026-09-14')
  })

  it('до начала расписания отдаёт первое вхождение', () => {
    expect(nextOccurrenceOnOrAfter(monthly('2026-09-14'), '2026-01-01')).toBe('2026-09-14')
  })

  it('после окончания отдаёт null', () => {
    expect(nextOccurrenceOnOrAfter(monthly('2026-01-14', 1, '2026-03-31'), '2026-09-01')).toBeNull()
  })

  it('работает на далёкой дате без перебора по дню', () => {
    const rule: RecurrenceRule = { frequency: 'daily', interval: 1, startDate: '2000-01-01' }
    expect(nextOccurrenceOnOrAfter(rule, '2026-09-21')).toBe('2026-09-21')
  })
})

describe('describeRecurrence', () => {
  it('простые случаи одним словом', () => {
    expect(describeRecurrence('monthly', 1)).toBe('Ежемесячно')
    expect(describeRecurrence('daily', 1)).toBe('Ежедневно')
    expect(describeRecurrence('weekly', 1)).toBe('Еженедельно')
    expect(describeRecurrence('yearly', 1)).toBe('Ежегодно')
  })

  it('интервал склоняется по-русски', () => {
    expect(describeRecurrence('weekly', 2)).toBe('Каждые 2 недели')
    expect(describeRecurrence('monthly', 3)).toBe('Каждые 3 месяца')
    expect(describeRecurrence('daily', 5)).toBe('Каждые 5 дней')
    expect(describeRecurrence('monthly', 11)).toBe('Каждые 11 месяцев')
  })
})
