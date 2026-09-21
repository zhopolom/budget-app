import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import type { Id, RecurringTransfer } from '../../types/entities'
import { Money } from '../../utils/money'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { recurringRepository } from '../recurring/repository'
import { transactionsRepository } from '../transactions/repository'
import { DEFAULT_ACCOUNT_IDS } from './defaults'
import { accountsRepository } from './repository'

const { card, cash } = DEFAULT_ACCOUNT_IDS

const addRule = (accountId: Id, startDate = '2026-12-01') =>
  recurringRepository.create(
    {
      type: 'expense',
      amount: Money.fromMajor(199),
      categoryId: C.subscriptions,
      accountId,
      note: 'Spotify',
      frequency: 'monthly',
      interval: 1,
      startDate,
      isActive: true,
    },
    '2026-09-21',
  )

const addTransferRule = (fromAccountId: Id, toAccountId: Id, startDate = '2026-12-01') =>
  recurringRepository.create(
    {
      type: 'transfer',
      amount: Money.fromMajor(2_000),
      fromAccountId,
      toAccountId,
      note: 'На накопительный',
      frequency: 'monthly',
      interval: 1,
      startDate,
      isActive: true,
    },
    '2026-09-21',
  )

/**
 * Правило прямо в базу: create намеренно сдвигает первое вхождение на сегодня,
 * поэтому через него не проверить генерацию за прошедшие даты.
 */
async function seedTransferRule(fromAccountId: Id, toAccountId: Id, startDate: string): Promise<Id> {
  const id = `rule-${await db.recurringTransactions.count()}`
  await db.recurringTransactions.add({
    id,
    type: 'transfer',
    amount: Money.fromMajor(2_000),
    fromAccountId,
    toAccountId,
    note: 'На накопительный',
    frequency: 'monthly',
    interval: 1,
    startDate,
    nextOccurrence: startDate,
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  })
  return id
}

beforeEach(resetTestDatabase)

describe('countUsage', () => {
  it('считает операции и правила отдельно', async () => {
    await transactionsRepository.create({
      type: 'expense',
      amount: Money.fromMajor(100),
      categoryId: C.groceries,
      accountId: cash,
      date: '2026-09-21',
      note: '',
    })
    await addRule(cash)

    expect(await accountsRepository.countUsage(cash)).toEqual({ transactions: 1, recurring: 1 })
    expect(await accountsRepository.countUsage(card)).toEqual({ transactions: 0, recurring: 0 })
  })

  it('регулярный перевод считается у обоих счетов', async () => {
    await addTransferRule(card, cash)

    expect((await accountsRepository.countUsage(card)).recurring).toBe(1)
    expect((await accountsRepository.countUsage(cash)).recurring).toBe(1)
  })
})

describe('remove со ссылками из расписаний', () => {
  it('не удаляет пустой счёт, занятый правилом, и называет причину', async () => {
    await addRule(cash)

    await expect(accountsRepository.remove(cash)).rejects.toThrow('регулярных операциях')
    expect(await db.accounts.get(cash)).toBeDefined()
    expect(await db.recurringTransactions.count()).toBe(1)
  })

  it('не удаляет счёт, занятый регулярным переводом с любой стороны', async () => {
    await addTransferRule(card, cash)

    await expect(accountsRepository.remove(card)).rejects.toThrow('регулярных операциях')
    await expect(accountsRepository.remove(cash)).rejects.toThrow('регулярных операциях')
  })
})

describe('transferAndRemove со ссылками из расписаний', () => {
  it('переносит правило-расход на новый счёт', async () => {
    const rule = await addRule(cash)

    const result = await accountsRepository.transferAndRemove(cash, card)

    expect(result.movedRecurring).toBe(1)
    const moved = await db.recurringTransactions.get(rule.id)
    expect(moved && 'accountId' in moved && moved.accountId).toBe(card)
    expect(moved?.isActive).toBe(true)
  })

  it('переносит обе стороны регулярного перевода', async () => {
    const savings = await accountsRepository.create({ name: 'Накопления', type: 'savings', initialBalance: 0 }, 'UAH')
    const rule = await addTransferRule(card, cash)

    await accountsRepository.transferAndRemove(cash, savings.id)

    const moved = (await db.recurringTransactions.get(rule.id)) as RecurringTransfer
    expect(moved.fromAccountId).toBe(card)
    expect(moved.toAccountId).toBe(savings.id)
    expect(moved.isActive).toBe(true)
  })

  it('регулярный перевод, у которого обе стороны свелись к одному счёту, выключается', async () => {
    const rule = { id: await seedTransferRule(card, cash, '2026-09-01') }

    const result = await accountsRepository.transferAndRemove(cash, card)

    expect(result.stoppedRecurring.map((item) => item.id)).toEqual([rule.id])
    const stopped = (await db.recurringTransactions.get(rule.id)) as RecurringTransfer
    expect(stopped.isActive).toBe(false)
    expect(stopped.fromAccountId).toBe(card)
    expect(stopped.toAccountId).toBe(card)

    // И главное: новых бессмысленных переводов он больше не создаёт
    await recurringRepository.generateDue('2026-12-31')
    expect(await db.transactions.count()).toBe(0)
  })

  it('атомарен: сбой на удалении откатывает и перенос правил', async () => {
    const rule = await addRule(cash)

    const failOnDelete = () => {
      throw new Error('Сбой при удалении')
    }
    db.accounts.hook('deleting', failOnDelete)
    try {
      await expect(accountsRepository.transferAndRemove(cash, card)).rejects.toThrow()
    } finally {
      db.accounts.hook('deleting').unsubscribe(failOnDelete)
    }

    expect(await db.accounts.get(cash)).toBeDefined()
    const untouched = await db.recurringTransactions.get(rule.id)
    expect(untouched && 'accountId' in untouched && untouched.accountId).toBe(cash)
  })
})

describe('генерация регулярных переводов', () => {
  it('создаёт переводы, которые не меняют общий капитал', async () => {
    const savings = await accountsRepository.create({ name: 'Накопления', type: 'savings', initialBalance: 0 }, 'UAH')
    await db.accounts.update(card, { initialBalance: Money.fromMajor(10_000) })
    await seedTransferRule(card, savings.id, '2026-09-01')

    const before = await db.accounts.toArray()
    const totalBefore = Money.sum(before.map((account) => account.initialBalance))

    const result = await recurringRepository.generateDue('2026-09-21')

    expect(result.created).toBe(1)
    const [created] = await db.transactions.toArray()
    expect(created).toMatchObject({
      type: 'transfer',
      amount: Money.fromMajor(2_000),
      fromAccountId: card,
      toAccountId: savings.id,
      date: '2026-09-01',
      occurrenceDate: '2026-09-01',
    })

    const { calculateTotalBalance, calculateTotals } = await import('../transactions/calculations')
    const transactions = await db.transactions.toArray()
    expect(calculateTotalBalance(await db.accounts.toArray(), transactions)).toBe(totalBefore)
    expect(calculateTotals(transactions)).toEqual({ income: 0, expense: 0, net: 0 })
  })

  it('повторный запуск не создаёт дублей перевода', async () => {
    const savings = await accountsRepository.create({ name: 'Накопления', type: 'savings', initialBalance: 0 }, 'UAH')
    await seedTransferRule(card, savings.id, '2026-07-01')

    await recurringRepository.generateDue('2026-09-21')
    const count = await db.transactions.count()
    await recurringRepository.generateDue('2026-09-21')

    expect(await db.transactions.count()).toBe(count)
    expect(count).toBe(3)
  })
})
