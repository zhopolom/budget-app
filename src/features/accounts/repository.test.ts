import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import type { Transaction } from '../../types/entities'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from './defaults'
import { SYSTEM_CATEGORY_IDS } from '../categories/defaults'
import { SETTINGS_ID } from '../settings/defaults'
import { calculateAccountBalances, calculateTotalBalance } from '../transactions/calculations'
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

async function addTransfer(fromAccountId: string, toAccountId: string, amount: number): Promise<Transaction> {
  return transactionsRepository.create({
    type: 'transfer',
    amount: Money.fromMajor(amount),
    fromAccountId,
    toAccountId,
    date: '2026-09-21',
    note: '',
  })
}

async function totalBalance() {
  return calculateTotalBalance(await db.accounts.toArray(), await db.transactions.toArray())
}

async function balanceOf(accountId: string) {
  const balances = calculateAccountBalances(await db.accounts.toArray(), await db.transactions.toArray())
  return balances.get(accountId)
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

describe('счёт с переводами', () => {
  it('перевод считается операцией счёта с обеих сторон', async () => {
    await addTransfer(card, cash, 500)

    expect(await transactionsRepository.countByAccount(card)).toBe(1)
    expect(await transactionsRepository.countByAccount(cash)).toBe(1)
    await expect(accountsRepository.remove(card)).rejects.toThrow('перенесите их')
    await expect(accountsRepository.remove(cash)).rejects.toThrow('перенесите их')
  })

  it('перенос переписывает обе стороны перевода и не теряет операции', async () => {
    const savings = await accountsRepository.create({ name: 'Накопления', type: 'savings', initialBalance: 0 }, 'UAH')
    await addTransfer(card, cash, 500)
    await addTransfer(savings.id, card, 200)
    await addExpense(card, 40)
    const balanceBefore = await totalBalance()
    const countBefore = await db.transactions.count()

    const moved = await accountsRepository.transferAndRemove(card, savings.id)

    expect(moved).toBe(3)
    expect(await db.transactions.count()).toBe(countBefore)
    expect(await db.accounts.get(card)).toBeUndefined()
    expect(await transactionsRepository.countByAccount(card)).toBe(0)
    expect(await totalBalance()).toBe(balanceBefore)

    // Обе стороны переводов переписаны: card исчез и из fromAccountId, и из toAccountId
    const transfers = await db.transactions.where('type').equals('transfer').toArray()
    expect(transfers.map((item) => ('fromAccountId' in item ? item.fromAccountId : null))).toEqual([
      savings.id,
      savings.id,
    ])
    expect(
      transfers.map((item) => ('toAccountId' in item ? item.toAccountId : null)).sort(),
    ).toEqual([savings.id, cash].sort())
  })

  it('перевод, обе стороны которого свелись к одному счёту, остаётся в истории и не искажает остаток', async () => {
    await addTransfer(card, cash, 500)
    const balanceBefore = await totalBalance()

    await accountsRepository.transferAndRemove(card, cash)

    const kept = await db.transactions.toArray()
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ type: 'transfer', fromAccountId: cash, toAccountId: cash })
    expect(await totalBalance()).toBe(balanceBefore)
    expect(await balanceOf(cash)).toBe(balanceBefore)
  })

  it('перенос атомарен и для переводов: сбой откатывает обе стороны', async () => {
    await addTransfer(card, cash, 500)
    await addExpense(card, 100)

    const failOnDelete = () => {
      throw new Error('Сбой при удалении')
    }
    db.accounts.hook('deleting', failOnDelete)
    try {
      await expect(accountsRepository.transferAndRemove(card, cash)).rejects.toThrow()
    } finally {
      db.accounts.hook('deleting').unsubscribe(failOnDelete)
    }

    expect(await db.accounts.get(card)).toBeDefined()
    expect(await db.transactions.where('fromAccountId').equals(card).count()).toBe(1)
    expect(await db.transactions.where('accountId').equals(card).count()).toBe(1)
  })
})

describe('transactionsRepository.update', () => {
  it('смена типа на перевод не оставляет старых categoryId и accountId', async () => {
    const created = await addExpense(card, 100)

    await transactionsRepository.update(created.id, {
      type: 'transfer',
      amount: Money.fromMajor(100),
      fromAccountId: card,
      toAccountId: cash,
      date: '2026-09-21',
      note: '',
    })

    const updated = await db.transactions.get(created.id)
    expect(updated).toMatchObject({ type: 'transfer', fromAccountId: card, toAccountId: cash })
    expect(updated && 'categoryId' in updated).toBe(false)
    expect(updated && 'accountId' in updated).toBe(false)
    expect(updated?.createdAt).toBe(created.createdAt)
  })

  it('смена перевода обратно на расход убирает счета перевода', async () => {
    const created = await addTransfer(card, cash, 100)

    await transactionsRepository.update(created.id, {
      type: 'expense',
      amount: Money.fromMajor(100),
      categoryId: SYSTEM_CATEGORY_IDS.groceries,
      accountId: cash,
      date: '2026-09-21',
      note: '',
    })

    const updated = await db.transactions.get(created.id)
    expect(updated).toMatchObject({ type: 'expense', accountId: cash })
    expect(updated && 'fromAccountId' in updated).toBe(false)
    expect(updated && 'toAccountId' in updated).toBe(false)
  })
})
