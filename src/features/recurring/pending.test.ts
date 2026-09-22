import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import type { Id, RecurringTransaction } from '../../types/entities'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { createBackup, restoreBackup, serializeBackup } from '../backup/repository'
import { parseBackup } from '../backup/parse'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { calculateTotalBalance } from '../transactions/calculations'
import { pendingOccurrencesRepository } from './pending'
import { recurringRepository } from './repository'

/**
 * Режим подтверждения (0.4, ТЗ §23–§26): в день срока операция не создаётся —
 * появляется вхождение, которое человек подтверждает, меняет или пропускает.
 * Главное свойство — ни при каких повторах не возникает второй операции.
 */

const { card, cash } = DEFAULT_ACCOUNT_IDS
const TODAY = '2026-09-21'

async function seedRule(patch: Partial<RecurringTransaction> = {}): Promise<Id> {
  const id = patch.id ?? `rule-${await db.recurringTransactions.count()}`
  await db.recurringTransactions.add({
    id,
    type: 'expense',
    amount: Money.fromMajor(1_840),
    categoryId: C.home,
    accountId: card,
    note: 'Коммунальные',
    frequency: 'monthly',
    interval: 1,
    startDate: '2026-07-21',
    nextOccurrence: '2026-09-21',
    isActive: true,
    executionMode: 'confirm',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  } as RecurringTransaction)
  return id
}

const transactionsOf = async (recurringId: Id) =>
  (await db.transactions.toArray()).filter((item) => item.recurringId === recurringId)

const totalBalance = async () => calculateTotalBalance(await db.accounts.toArray(), await db.transactions.toArray())

beforeEach(resetTestDatabase)

describe('генерация в режиме confirm', () => {
  it('создаёт ожидающее вхождение вместо операции: остаток не меняется', async () => {
    const id = await seedRule()
    const before = await totalBalance()

    const result = await recurringRepository.generateDue(TODAY)

    expect(result).toEqual({ created: 0, pending: 1, rules: 1, finished: 0 })
    expect(await transactionsOf(id)).toEqual([])
    expect(await totalBalance()).toBe(before)

    const [occurrence] = await pendingOccurrencesRepository.listPending()
    expect(occurrence).toMatchObject({ recurringId: id, scheduledDate: '2026-09-21', status: 'pending' })
    // Расписание двигается дальше, как и у автоматического правила
    expect((await db.recurringTransactions.get(id))?.nextOccurrence).toBe('2026-10-21')
  })

  it('пропущенные месяцы дают по одному вхождению на каждый срок', async () => {
    const id = await seedRule({ nextOccurrence: '2026-07-21' })
    await recurringRepository.generateDue(TODAY)

    const dates = (await pendingOccurrencesRepository.listByRule(id)).map((item) => item.scheduledDate)
    expect(dates).toEqual(['2026-07-21', '2026-08-21', '2026-09-21'])
  })

  it('идемпотентна: повторный запуск не плодит вхождений', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue(TODAY)
    await recurringRepository.generateDue(TODAY)
    await recurringRepository.generateDue('2026-09-25')

    expect(await pendingOccurrencesRepository.listByRule(id)).toHaveLength(1)
  })

  it('автоматическое правило работает как раньше', async () => {
    const id = await seedRule({ executionMode: 'automatic' })
    const result = await recurringRepository.generateDue(TODAY)

    expect(result).toEqual({ created: 1, pending: 0, rules: 1, finished: 0 })
    expect(await transactionsOf(id)).toHaveLength(1)
    expect(await pendingOccurrencesRepository.countPending()).toBe(0)
  })

  it('правило без режима (данные до 0.4) считается автоматическим', async () => {
    const id = await seedRule({ executionMode: undefined })
    await recurringRepository.generateDue(TODAY)
    expect(await transactionsOf(id)).toHaveLength(1)
    expect(await pendingOccurrencesRepository.countPending()).toBe(0)
  })
})

describe('подтверждение', () => {
  it('создаёт операцию по расписанию и помечает вхождение', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue(TODAY)
    const [occurrence] = await pendingOccurrencesRepository.listPending()

    const transaction = await pendingOccurrencesRepository.confirm(occurrence.id)

    expect(transaction).toMatchObject({
      type: 'expense',
      amount: Money.fromMajor(1_840),
      accountId: card,
      categoryId: C.home,
      date: '2026-09-21',
      recurringId: id,
      occurrenceDate: '2026-09-21',
    })
    expect(await pendingOccurrencesRepository.get(occurrence.id)).toMatchObject({
      status: 'confirmed',
      transactionId: transaction.id,
    })
    expect(await pendingOccurrencesRepository.countPending()).toBe(0)
    expect(await totalBalance()).toBe(-Money.fromMajor(1_840))
  })

  it('повторное подтверждение — ошибка, а не вторая операция', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue(TODAY)
    const [occurrence] = await pendingOccurrencesRepository.listPending()

    await pendingOccurrencesRepository.confirm(occurrence.id)
    await expect(pendingOccurrencesRepository.confirm(occurrence.id)).rejects.toThrow('уже подтверждена')
    expect(await transactionsOf(id)).toHaveLength(1)
  })

  it('изменённое вхождение: сумма и дата только у этой операции, расписание прежнее', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue(TODAY)
    const [occurrence] = await pendingOccurrencesRepository.listPending()

    const transaction = await pendingOccurrencesRepository.confirm(occurrence.id, {
      override: {
        type: 'expense',
        amount: Money.fromMajor(2_100),
        accountId: cash,
        categoryId: C.home,
        date: '2026-09-23',
        note: 'Коммунальные, с перерасчётом',
      },
    })

    expect(transaction).toMatchObject({
      amount: Money.fromMajor(2_100),
      accountId: cash,
      date: '2026-09-23',
      note: 'Коммунальные, с перерасчётом',
      // Связь с расписанием — по сроку, а не по новой дате: иначе следующий запуск создал бы дубль
      recurringId: id,
      occurrenceDate: '2026-09-21',
    })
    const rule = await db.recurringTransactions.get(id)
    expect(rule).toMatchObject({ amount: Money.fromMajor(1_840), accountId: card, note: 'Коммунальные' })

    // День разобран: генерация его не возвращает
    await recurringRepository.generateDue(TODAY)
    expect(await transactionsOf(id)).toHaveLength(1)
    expect(await pendingOccurrencesRepository.countPending()).toBe(0)
  })

  it('«изменить все будущие» переписывает расписание, но не его даты', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue(TODAY)
    const [occurrence] = await pendingOccurrencesRepository.listPending()

    await pendingOccurrencesRepository.confirm(occurrence.id, {
      override: {
        type: 'expense',
        amount: Money.fromMajor(2_100),
        accountId: cash,
        categoryId: C.expenseOther,
        date: '2026-09-23',
        note: 'Коммунальные+',
      },
      applyToRule: true,
    })

    const rule = await db.recurringTransactions.get(id)
    expect(rule).toMatchObject({
      amount: Money.fromMajor(2_100),
      accountId: cash,
      categoryId: C.expenseOther,
      note: 'Коммунальные+',
      startDate: '2026-07-21',
      nextOccurrence: '2026-10-21',
      executionMode: 'confirm',
    })
  })

  it('тип операции задаёт расписание: расход не подтвердить переводом', async () => {
    await seedRule()
    await recurringRepository.generateDue(TODAY)
    const [occurrence] = await pendingOccurrencesRepository.listPending()

    await expect(
      pendingOccurrencesRepository.confirm(occurrence.id, {
        override: { type: 'transfer', amount: 100, fromAccountId: card, toAccountId: cash, date: TODAY, note: '' },
      }),
    ).rejects.toThrow('не совпадает')
    expect(await db.transactions.count()).toBe(0)
  })

  it('подтверждение регулярного перевода создаёт перевод', async () => {
    const id = await seedRule({
      type: 'transfer',
      fromAccountId: card,
      toAccountId: cash,
      amount: Money.fromMajor(2_000),
      note: 'На накопительный',
    } as Partial<RecurringTransaction>)
    await recurringRepository.generateDue(TODAY)
    const [occurrence] = await pendingOccurrencesRepository.listPending()

    const transaction = await pendingOccurrencesRepository.confirm(occurrence.id)
    expect(transaction).toMatchObject({ type: 'transfer', fromAccountId: card, toAccountId: cash, recurringId: id })
    // Перевод общий капитал не меняет
    expect(await totalBalance()).toBe(0)
  })
})

describe('пропуск', () => {
  it('ничего не создаёт, а день считается разобранным', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue(TODAY)
    const [occurrence] = await pendingOccurrencesRepository.listPending()

    await pendingOccurrencesRepository.skip(occurrence.id)

    expect(await transactionsOf(id)).toEqual([])
    expect(await pendingOccurrencesRepository.countPending()).toBe(0)
    expect((await pendingOccurrencesRepository.get(occurrence.id))?.status).toBe('skipped')

    await recurringRepository.generateDue(TODAY)
    expect(await pendingOccurrencesRepository.listByRule(id)).toHaveLength(1)
    await expect(pendingOccurrencesRepository.confirm(occurrence.id)).rejects.toThrow('уже пропущена')
  })

  it('пропущенный день не воскресает после перевода правила в automatic', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue(TODAY)
    const [occurrence] = await pendingOccurrencesRepository.listPending()
    await pendingOccurrencesRepository.skip(occurrence.id)

    // Пользователь передумал: пусть создаётся само — но только со следующего срока
    await db.recurringTransactions.update(id, { executionMode: 'automatic', nextOccurrence: '2026-09-21' })
    await recurringRepository.generateDue(TODAY)

    expect(await transactionsOf(id)).toEqual([])
  })
})

describe('связь с расписанием', () => {
  it('удаление правила забирает его ожидающие вхождения, операции остаются', async () => {
    const id = await seedRule({ nextOccurrence: '2026-08-21' })
    await recurringRepository.generateDue(TODAY)
    const [first] = await pendingOccurrencesRepository.listPending()
    await pendingOccurrencesRepository.confirm(first.id)

    await recurringRepository.remove(id)

    expect(await db.pendingOccurrences.count()).toBe(0)
    expect(await transactionsOf(id)).toHaveLength(1)
  })

  it('вхождение удалённого расписания не показывается и не подтверждается', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue(TODAY)
    const [occurrence] = await pendingOccurrencesRepository.listPending()
    // Ситуация из копии, собранной вручную: запись есть, а правила нет
    await db.recurringTransactions.delete(id)

    expect(await pendingOccurrencesRepository.listPendingViews()).toEqual([])
    await expect(pendingOccurrencesRepository.confirm(occurrence.id)).rejects.toThrow('удалено')
  })

  it('досоздание за паузу в режиме confirm даёт вхождения, а не операции', async () => {
    const id = await seedRule({ nextOccurrence: '2026-07-21', isActive: false })

    const created = await recurringRepository.setActive(id, true, TODAY, { backfill: true })

    expect(created).toBe(3)
    expect(await transactionsOf(id)).toEqual([])
    expect(await pendingOccurrencesRepository.listByRule(id)).toHaveLength(3)
  })

  it('resumeInfo не считает пропущенным то, что уже ждёт подтверждения', async () => {
    const id = await seedRule({ nextOccurrence: '2026-07-21' })
    await recurringRepository.generateDue(TODAY)
    await recurringRepository.setActive(id, false, TODAY)

    const info = await recurringRepository.resumeInfo(id, TODAY)
    expect(info.missed).toBe(0)
  })
})

describe('резервная копия', () => {
  it('переносит режим и ожидающие вхождения без потерь', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue(TODAY)
    const [occurrence] = await pendingOccurrencesRepository.listPending()

    const file = serializeBackup(await createBackup(new Date(2026, 8, 21), '0.4.0'))
    await resetTestDatabase()
    const parsed = parseBackup(file)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.schemaVersion).toBe(4)
    await restoreBackup(parsed.data)

    expect((await db.recurringTransactions.get(id))?.executionMode).toBe('confirm')
    expect(await pendingOccurrencesRepository.get(occurrence.id)).toMatchObject({
      recurringId: id,
      scheduledDate: '2026-09-21',
      status: 'pending',
    })

    // После восстановления запуск ничего не задваивает
    await recurringRepository.generateDue(TODAY)
    expect(await pendingOccurrencesRepository.listByRule(id)).toHaveLength(1)
  })

  it('копия v3 без режима читается: правила автоматические, вхождений нет', async () => {
    const file = JSON.stringify({
      app: 'budget',
      schemaVersion: 3,
      exportDate: '2026-09-21T10:00:00.000Z',
      appVersion: '0.3.2',
      data: {
        accounts: [{ id: 'card', name: 'Карта', type: 'card', initialBalance: 0, currency: 'UAH', createdAt: 1, updatedAt: 1 }],
        categories: [],
        transactions: [],
        budgets: [],
        categoryBudgets: [],
        recurringTransactions: [
          {
            id: 'r-1',
            type: 'expense',
            amount: 19_900,
            categoryId: 'cat-exp-subscriptions',
            accountId: 'card',
            note: 'Spotify',
            frequency: 'monthly',
            interval: 1,
            startDate: '2026-09-14',
            nextOccurrence: '2026-10-14',
            isActive: true,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        settings: { id: 'app', baseCurrency: 'UAH', theme: 'system', lastAccountId: 'card' },
      },
    })

    const parsed = parseBackup(file)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.data.recurringTransactions[0].executionMode).toBe('automatic')
    expect(parsed.data.pendingOccurrences).toEqual([])
  })

  it('отказывается от копии с двумя вхождениями на один срок', async () => {
    const id = await seedRule()
    await recurringRepository.generateDue(TODAY)
    const backup = await createBackup(new Date(2026, 8, 21), '0.4.0')
    const [occurrence] = backup.data.pendingOccurrences
    backup.data.pendingOccurrences.push({ ...occurrence, id: 'dup' })

    const parsed = parseBackup(serializeBackup(backup))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.details?.[0]).toContain(`${id}@2026-09-21`)
  })
})
