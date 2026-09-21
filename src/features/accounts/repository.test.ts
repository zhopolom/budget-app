import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import type { Transaction } from '../../types/entities'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from './defaults'
import { SYSTEM_CATEGORY_IDS } from '../categories/defaults'
import { SETTINGS_ID } from '../settings/defaults'
import { calculateTotalBalance } from '../transactions/calculations'
import { transactionsRepository } from '../transactions/repository'
import { accountsRepository } from './repository'

const { card, cash } = DEFAULT_ACCOUNT_IDS

async function addExpense(accountId: string, amount: number): Promise<Transaction> {
  return transactionsRepository.create({
    type: 'expense',
    amount: Money.fromMajor(amount),
    categoryId: SYSTEM_CATEGORY_IDS.groceries,
    accountId,
    date: '2026-09-21',
    note: '',
  })
}

async function totalBalance() {
  return calculateTotalBalance(await db.accounts.toArray(), await db.transactions.toArray())
}

beforeEach(resetTestDatabase)

describe('accountsRepository.remove', () => {
  it('не удаляет счёт с операциями и ничего не меняет', async () => {
    await addExpense(cash, 100)

    await expect(accountsRepository.remove(cash)).rejects.toThrow('перенесите их')
    expect(await db.accounts.get(cash)).toBeDefined()
    expect(await db.transactions.where('accountId').equals(cash).count()).toBe(1)
  })

  it('удаляет счёт без операций и подставляет другой счёт по умолчанию', async () => {
    await db.settings.update(SETTINGS_ID, { lastAccountId: cash })

    await accountsRepository.remove(cash)

    expect(await db.accounts.get(cash)).toBeUndefined()
    expect((await db.settings.get(SETTINGS_ID))?.lastAccountId).toBe(card)
  })

  it('не удаляет единственный счёт', async () => {
    await accountsRepository.remove(cash)
    await expect(accountsRepository.remove(card)).rejects.toThrow('единственный')
  })
})

describe('accountsRepository.transferAndRemove', () => {
  it('переносит все операции, начальный остаток и удаляет счёт; общий баланс не меняется', async () => {
    await db.accounts.update(cash, { initialBalance: Money.fromMajor(2_000) })
    await Promise.all([addExpense(cash, 100), addExpense(cash, 250), addExpense(card, 40)])
    const balanceBefore = await totalBalance()

    const moved = await accountsRepository.transferAndRemove(cash, card)

    expect(moved).toBe(2)
    expect(await db.accounts.get(cash)).toBeUndefined()
    expect(await db.transactions.where('accountId').equals(cash).count()).toBe(0)
    expect(await db.transactions.where('accountId').equals(card).count()).toBe(3)
    expect((await db.accounts.get(card))?.initialBalance).toBe(Money.fromMajor(2_000))
    expect(await totalBalance()).toBe(balanceBefore)
    // Последней операцией была запись на Карту, но проверим и замену удалённого счёта
    expect((await db.settings.get(SETTINGS_ID))?.lastAccountId).toBe(card)
  })

  it('заменяет удалённый счёт в «последнем выбранном»', async () => {
    await addExpense(cash, 100) // lastAccountId = cash
    await accountsRepository.transferAndRemove(cash, card)
    expect((await db.settings.get(SETTINGS_ID))?.lastAccountId).toBe(card)
  })

  it('атомарен: при сбое посреди операции откатывается и перенос, и удаление', async () => {
    await db.accounts.update(cash, { initialBalance: Money.fromMajor(500) })
    const created = await Promise.all([addExpense(cash, 100), addExpense(cash, 200), addExpense(cash, 300)])

    // Операции уже перенесены, остаток уже сложен — и тут удаление счёта падает
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
    expect((await db.accounts.get(card))?.initialBalance).toBe(0)
    const onCash = await db.transactions.where('accountId').equals(cash).toArray()
    expect(onCash.map((t) => t.id).sort()).toEqual(created.map((t) => t.id).sort())
    expect(await db.transactions.where('accountId').equals(card).count()).toBe(0)
  })

  it('отклоняет перенос на тот же, несуществующий или счёт в другой валюте', async () => {
    await addExpense(cash, 100)
    await expect(accountsRepository.transferAndRemove(cash, cash)).rejects.toThrow('другой счёт')
    await expect(accountsRepository.transferAndRemove(cash, 'missing')).rejects.toThrow('не найден')

    await db.accounts.update(card, { currency: 'USD' })
    await expect(accountsRepository.transferAndRemove(cash, card)).rejects.toThrow('валютах')
    expect(await db.transactions.where('accountId').equals(cash).count()).toBe(1)
  })
})
