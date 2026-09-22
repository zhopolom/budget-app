import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import type { Id, IsoDate, RecurrenceFrequency } from '../../types/entities'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { recurringRepository } from './repository'

/**
 * Возобновление правила после паузы.
 *
 * Сегодняшнее вхождение пропущенным не считается: пауза кончилась, и платёж
 * просто наступил. Поэтому «Не создавать» его всё равно создаёт, а число
 * в диалоге — это ровно то, что досоздаст «Создать N».
 */

const { card } = DEFAULT_ACCOUNT_IDS

interface SeedOptions {
  frequency?: RecurrenceFrequency
  interval?: number
  startDate?: IsoDate
  endDate?: IsoDate
  nextOccurrence?: IsoDate
  isActive?: boolean
}

async function seedRule(options: SeedOptions = {}): Promise<Id> {
  const startDate = options.startDate ?? '2026-01-14'
  const id = `rule-${await db.recurringTransactions.count()}`

  await db.recurringTransactions.add({
    id,
    type: 'expense',
    amount: Money.fromMajor(199),
    categoryId: C.subscriptions,
    accountId: card,
    note: 'Spotify',
    frequency: options.frequency ?? 'monthly',
    interval: options.interval ?? 1,
    startDate,
    ...(options.endDate ? { endDate: options.endDate } : {}),
    nextOccurrence: options.nextOccurrence ?? startDate,
    isActive: options.isActive ?? true,
    executionMode: 'automatic',
    createdAt: 1,
    updatedAt: 1,
  })
  return id
}

/** Пауза: создали первый платёж и выключили правило. */
async function paused(options: SeedOptions = {}): Promise<Id> {
  const id = await seedRule(options)
  await recurringRepository.generateDue(options.startDate ?? '2026-01-14')
  await recurringRepository.setActive(id, false, options.startDate ?? '2026-01-14')
  return id
}

beforeEach(resetTestDatabase)

describe('resumeInfo', () => {
  it('в день платежа не считает сегодняшнее вхождение пропущенным', async () => {
    const id = await paused()

    // Февраль–август — семь пропущенных; сентябрьский платёж наступает сегодня
    expect(await recurringRepository.resumeInfo(id, '2026-09-14')).toEqual({
      missed: 7,
      dueToday: true,
      finished: false,
      truncated: false,
    })
  })

  it('между платежами считает все вхождения паузы', async () => {
    const id = await paused()

    expect(await recurringRepository.resumeInfo(id, '2026-09-15')).toEqual({
      missed: 8,
      dueToday: false,
      finished: false,
      truncated: false,
    })
  })

  it('до начала расписания пропущенных нет', async () => {
    const id = await seedRule({ startDate: '2026-12-01', nextOccurrence: '2026-12-01' })
    await recurringRepository.setActive(id, false, '2026-09-14')

    expect(await recurringRepository.resumeInfo(id, '2026-09-14')).toEqual({
      missed: 0,
      dueToday: false,
      finished: false,
      truncated: false,
    })
  })

  it('у закончившегося расписания считает всё, что осталось несозданным', async () => {
    const id = await paused({ endDate: '2026-05-31' })

    // Февраль–май: расписание кончилось, возобновлять нечего
    expect(await recurringRepository.resumeInfo(id, '2026-09-14')).toEqual({
      missed: 4,
      dueToday: false,
      finished: true,
      truncated: false,
    })
  })
})

describe('возобновление без досоздания', () => {
  it('в день платежа создаёт ровно сегодняшний платёж', async () => {
    const id = await paused()

    await recurringRepository.setActive(id, true, '2026-09-14')

    expect((await recurringRepository.generateDue('2026-09-14')).created).toBe(1)
    expect(await recurringRepository.countGenerated(id)).toBe(2)
  })

  it('между платежами не создаёт ничего', async () => {
    const id = await paused()

    await recurringRepository.setActive(id, true, '2026-09-15')

    expect((await recurringRepository.generateDue('2026-09-15')).created).toBe(0)
    expect((await db.recurringTransactions.get(id))?.nextOccurrence).toBe('2026-10-14')
  })
})

describe('досоздание закончившегося расписания', () => {
  it('создаёт пропущенное и оставляет правило выключенным', async () => {
    const id = await paused({ endDate: '2026-05-31' })

    const created = await recurringRepository.setActive(id, true, '2026-09-14', { backfill: true })

    expect(created).toBe(4)
    expect((await db.recurringTransactions.get(id))?.isActive).toBe(false)
  })
})

describe('«без backfill + missed» равно «с backfill»', () => {
  const cases = [
    { name: 'ежедневное', frequency: 'daily' as const, interval: 1, startDate: '2026-08-14', today: '2026-09-14' },
    { name: 'раз в две недели', frequency: 'weekly' as const, interval: 2, startDate: '2026-01-14', today: '2026-09-15' },
    { name: 'раз в три месяца', frequency: 'monthly' as const, interval: 3, startDate: '2026-01-14', today: '2026-10-14' },
  ]

  for (const { name, frequency, interval, startDate, today } of cases) {
    it(`сходится: ${name}`, async () => {
      const withoutId = await paused({ frequency, interval, startDate })
      const info = await recurringRepository.resumeInfo(withoutId, today)

      await recurringRepository.setActive(withoutId, true, today)
      const withoutBackfill = (await recurringRepository.generateDue(today)).created

      // То же правило, но с досозданием
      const withId = await paused({ frequency, interval, startDate })
      const withBackfill = await recurringRepository.setActive(withId, true, today, { backfill: true })

      expect(withoutBackfill + info.missed).toBe(withBackfill)
    })
  }
})
