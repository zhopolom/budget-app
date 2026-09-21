import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import type { Id } from '../../types/entities'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { MAX_OCCURRENCES_PER_RUN } from './occurrences'
import { recurringRepository } from './repository'
import type { RecurringEntryInput } from './repository'

const { card } = DEFAULT_ACCOUNT_IDS

const spotify = (patch: Partial<RecurringEntryInput> = {}): RecurringEntryInput => ({
  type: 'expense',
  amount: Money.fromMajor(199),
  categoryId: C.subscriptions,
  accountId: card,
  note: 'Spotify',
  frequency: 'monthly',
  interval: 1,
  startDate: '2026-07-14',
  isActive: true,
  ...patch,
})

/** Расписание прямо в базу: create сдвигает первое вхождение на сегодня. */
async function seedRule(patch: Partial<RecurringEntryInput> & { nextOccurrence?: string } = {}): Promise<Id> {
  const { nextOccurrence, ...input } = patch
  const base = spotify(input)
  const id = `rule-${await db.recurringTransactions.count()}`
  await db.recurringTransactions.add({
    ...base,
    id,
    nextOccurrence: nextOccurrence ?? base.startDate,
    createdAt: 1,
    updatedAt: 1,
  })
  return id
}

const datesOf = async (recurringId: Id) =>
  (await db.transactions.toArray())
    .filter((item) => item.recurringId === recurringId)
    .map((item) => item.date)
    .sort()

beforeEach(resetTestDatabase)

describe('generateDue', () => {
  it('создаёт все пропущенные вхождения разом', async () => {
    const id = await seedRule()

    const result = await recurringRepository.generateDue('2026-09-21')

    expect(result.created).toBe(3)
    expect(await datesOf(id)).toEqual(['2026-07-14', '2026-08-14', '2026-09-14'])
  })

  it('повторный запуск не создаёт дублей', async () => {
    const id = await seedRule()

    await recurringRepository.generateDue('2026-09-21')
    const second = await recurringRepository.generateDue('2026-09-21')
    const third = await recurringRepository.generateDue('2026-09-25')

    expect(second.created).toBe(0)
    expect(third.created).toBe(0)
    expect(await datesOf(id)).toEqual(['2026-07-14', '2026-08-14', '2026-09-14'])
  })

  it('уникальный индекс не даёт записать одно вхождение дважды', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue('2026-07-20')

    const duplicate = db.transactions.add({
      id: 'manual-duplicate',
      type: 'expense',
      amount: Money.fromMajor(199),
      categoryId: C.subscriptions,
      accountId: card,
      date: '2026-07-14',
      note: '',
      recurringId: id,
      occurrenceDate: '2026-07-14',
      createdAt: 1,
      updatedAt: 1,
    })

    await expect(duplicate).rejects.toThrow()
    expect(await datesOf(id)).toEqual(['2026-07-14'])
  })

  it('сдвигает nextOccurrence на следующее вхождение', async () => {
    const id = await seedRule()

    await recurringRepository.generateDue('2026-09-21')

    expect((await db.recurringTransactions.get(id))?.nextOccurrence).toBe('2026-10-14')
    expect((await db.recurringTransactions.get(id))?.lastGeneratedAt).toBeDefined()
  })

  it('отключённое расписание пропускается и остаётся нетронутым', async () => {
    const id = await seedRule({ isActive: false })

    const result = await recurringRepository.generateDue('2026-09-21')

    expect(result.created).toBe(0)
    expect(await datesOf(id)).toEqual([])
    expect((await db.recurringTransactions.get(id))?.nextOccurrence).toBe('2026-07-14')
  })

  it('не забегает вперёд: будущие вхождения не создаются', async () => {
    const id = await seedRule({ startDate: '2026-10-14' })

    const result = await recurringRepository.generateDue('2026-09-21')

    expect(result.created).toBe(0)
    expect(await datesOf(id)).toEqual([])
  })

  it('после даты окончания расписание отключается', async () => {
    const id = await seedRule({ endDate: '2026-08-31' })

    const result = await recurringRepository.generateDue('2026-09-21')

    expect(result.created).toBe(2)
    expect(result.finished).toBe(1)
    expect((await db.recurringTransactions.get(id))?.isActive).toBe(false)
    expect(await datesOf(id)).toEqual(['2026-07-14', '2026-08-14'])
  })

  it('созданные операции ссылаются на расписание и хранят плановую дату', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue('2026-07-20')

    const [created] = await db.transactions.toArray()
    expect(created).toMatchObject({
      type: 'expense',
      amount: Money.fromMajor(199),
      categoryId: C.subscriptions,
      accountId: card,
      note: 'Spotify',
      recurringId: id,
      occurrenceDate: '2026-07-14',
      date: '2026-07-14',
    })
  })

  it('несколько расписаний обрабатываются за один проход', async () => {
    const spotifyId = await seedRule()
    const salaryId = await seedRule({
      type: 'income',
      amount: Money.fromMajor(32_000),
      categoryId: C.salary,
      note: 'Зарплата',
      startDate: '2026-08-01',
    })

    const result = await recurringRepository.generateDue('2026-09-21')

    expect(result.rules).toBe(2)
    expect(result.created).toBe(5)
    expect(await datesOf(spotifyId)).toHaveLength(3)
    expect(await datesOf(salaryId)).toEqual(['2026-08-01', '2026-09-01'])
  })

  it('ежедневное расписание за годы догоняется частями, без дублей', async () => {
    const id = await seedRule({ frequency: 'daily', interval: 1, startDate: '2025-01-01', note: 'Кофе' })

    // 2025-01-01 … 2026-09-21 — это 629 дней, за один проход создаётся не больше лимита
    const first = await recurringRepository.generateDue('2026-09-21')
    expect(first.created).toBe(MAX_OCCURRENCES_PER_RUN)

    const second = await recurringRepository.generateDue('2026-09-21')
    expect(second.created).toBe(629 - MAX_OCCURRENCES_PER_RUN)

    const third = await recurringRepository.generateDue('2026-09-21')
    expect(third.created).toBe(0)

    const dates = await datesOf(id)
    expect(dates).toHaveLength(629)
    expect(new Set(dates).size).toBe(629)
    expect(dates[0]).toBe('2025-01-01')
    expect(dates.at(-1)).toBe('2026-09-21')
  })

  it('удаление расписания не трогает созданные операции', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue('2026-09-21')

    await recurringRepository.remove(id)

    expect(await db.recurringTransactions.get(id)).toBeUndefined()
    expect(await datesOf(id)).toHaveLength(3)
  })
})

describe('create и update', () => {
  it('новое расписание начинается не в прошлом', async () => {
    const created = await recurringRepository.create(spotify({ startDate: '2026-01-14' }), '2026-09-21')

    // Начало оставляем как указал пользователь, но заваливать историю не будем
    expect(created.startDate).toBe('2026-01-14')
    expect(created.nextOccurrence).toBe('2026-10-14')

    expect((await recurringRepository.generateDue('2026-09-21')).created).toBe(0)
  })

  it('расписание с началом в будущем ждёт своей даты', async () => {
    const created = await recurringRepository.create(spotify({ startDate: '2026-12-01' }), '2026-09-21')
    expect(created.nextOccurrence).toBe('2026-12-01')
  })

  it('изменение расписания пересчитывает ближайшее вхождение и не трогает историю', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue('2026-09-21')

    await recurringRepository.update(id, spotify({ frequency: 'weekly', interval: 2, startDate: '2026-09-01' }), '2026-09-21')

    const updated = await db.recurringTransactions.get(id)
    expect(updated?.frequency).toBe('weekly')
    expect(updated?.nextOccurrence).toBe('2026-09-29')
    expect(await datesOf(id)).toHaveLength(3)
  })

  it('setActive выключает и включает расписание', async () => {
    const id = await seedRule()
    await recurringRepository.setActive(id, false, '2026-09-21')
    expect((await db.recurringTransactions.get(id))?.isActive).toBe(false)

    await recurringRepository.setActive(id, true, '2026-09-21')
    expect((await db.recurringTransactions.get(id))?.isActive).toBe(true)
  })

  it('countGenerated считает созданные операции', async () => {
    const id = await seedRule()
    expect(await recurringRepository.countGenerated(id)).toBe(0)

    await recurringRepository.generateDue('2026-09-21')
    expect(await recurringRepository.countGenerated(id)).toBe(3)
  })
})
