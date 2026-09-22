import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import type { Id } from '../../types/entities'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { accountsRepository } from '../accounts/repository'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { transactionsRepository } from '../transactions/repository'
import { goalsRepository } from './repository'
import type { GoalInput } from './validation'

const { card } = DEFAULT_ACCOUNT_IDS

const input = (patch: Partial<GoalInput> = {}): GoalInput => ({
  name: 'MacBook',
  icon: '💻',
  targetAmount: Money.fromMajor(80_000),
  targetDate: '2026-12-31',
  linkedAccountId: null,
  currentAmount: Money.fromMajor(1_000),
  ...patch,
})

async function createSavings(name = 'Накопительный', initialBalance = 0): Promise<Id> {
  return (await accountsRepository.create({ name, type: 'savings', initialBalance }, 'UAH')).id
}

beforeEach(resetTestDatabase)

describe('goalsRepository', () => {
  it('создаёт цель без счёта с накопленным вручную', async () => {
    const goal = await goalsRepository.create(input())
    expect(await goalsRepository.get(goal.id)).toMatchObject({
      name: 'MacBook',
      targetAmount: Money.fromMajor(80_000),
      currentAmount: Money.fromMajor(1_000),
      isArchived: false,
    })
    expect((await goalsRepository.get(goal.id))?.linkedAccountId).toBeUndefined()
  })

  it('связывает только с накопительным счётом', async () => {
    await expect(goalsRepository.create(input({ linkedAccountId: card, currentAmount: null }))).rejects.toThrow('накопительный')
    await expect(goalsRepository.create(input({ linkedAccountId: 'acc-ghost', currentAmount: null }))).rejects.toThrow('не найден')

    const savings = await createSavings()
    const goal = await goalsRepository.create(input({ linkedAccountId: savings, currentAmount: null }))
    expect((await goalsRepository.get(goal.id))?.linkedAccountId).toBe(savings)
  })

  it('у цели со счётом нельзя хранить накопленное вручную', async () => {
    const savings = await createSavings()
    await expect(goalsRepository.create(input({ linkedAccountId: savings }))).rejects.toThrow('по остатку')
  })

  it('правка перезаписывает поля: снятый срок не остаётся от старой версии', async () => {
    const goal = await goalsRepository.create(input())
    await goalsRepository.update(goal.id, input({ targetDate: null, currentAmount: Money.fromMajor(5_000) }))

    const updated = await goalsRepository.get(goal.id)
    expect(updated?.targetDate).toBeUndefined()
    expect(updated?.currentAmount).toBe(Money.fromMajor(5_000))
    expect(updated?.createdAt).toBe(goal.createdAt)
  })

  it('архив и удаление не трогают счета и операции', async () => {
    const savings = await createSavings('Копилка', Money.fromMajor(3_000))
    await transactionsRepository.create({
      type: 'transfer',
      amount: Money.fromMajor(2_000),
      fromAccountId: card,
      toAccountId: savings,
      date: '2026-09-20',
      note: '',
    })
    const goal = await goalsRepository.create(input({ linkedAccountId: savings, currentAmount: null }))

    await goalsRepository.setArchived(goal.id, true)
    expect((await goalsRepository.get(goal.id))?.isArchived).toBe(true)

    await goalsRepository.remove(goal.id)
    expect(await goalsRepository.get(goal.id)).toBeUndefined()
    expect(await db.accounts.get(savings)).toBeDefined()
    expect(await db.transactions.count()).toBe(1)
  })

  it('отвергает суммы вне политики Money', async () => {
    await expect(goalsRepository.create(input({ targetAmount: 0 }))).rejects.toThrow(RangeError)
    await expect(goalsRepository.create(input({ currentAmount: -1 }))).rejects.toThrow(RangeError)
    await expect(goalsRepository.create(input({ targetAmount: Number.NaN }))).rejects.toThrow(RangeError)
  })
})

describe('удаление счёта с целями (ТЗ §34)', () => {
  it('перевод на накопительный счёт растит прогресс цели без искусственного расхода', async () => {
    const savings = await createSavings()
    await transactionsRepository.create({
      type: 'transfer',
      amount: Money.fromMajor(2_000),
      fromAccountId: card,
      toAccountId: savings,
      date: '2026-09-20',
      note: '',
    })
    const goal = await goalsRepository.create(input({ linkedAccountId: savings, currentAmount: null }))

    const { calculateAccountBalances, calculateTotals } = await import('../transactions/calculations')
    const { buildGoalProgress } = await import('./service')
    const accounts = await db.accounts.toArray()
    const transactions = await db.transactions.toArray()
    const progress = buildGoalProgress((await goalsRepository.get(goal.id))!, accounts, calculateAccountBalances(accounts, transactions), '2026-09-22')

    expect(progress.current).toBe(Money.fromMajor(2_000))
    expect(calculateTotals(transactions).expense).toBe(0)
  })

  it('перенос на другой накопительный счёт перевязывает цель', async () => {
    const first = await createSavings('Первый')
    const second = await createSavings('Второй')
    await transactionsRepository.create({ type: 'transfer', amount: Money.fromMajor(500), fromAccountId: card, toAccountId: first, date: '2026-09-20', note: '' })
    const goal = await goalsRepository.create(input({ linkedAccountId: first, currentAmount: null }))

    const result = await accountsRepository.transferAndRemove(first, second)

    expect(result.goals).toBe(1)
    expect(await goalsRepository.get(goal.id)).toMatchObject({ linkedAccountId: second })
    expect((await goalsRepository.get(goal.id))?.currentAmount).toBeUndefined()
  })

  it('перенос на карту оставляет цель без счёта, накопленное сохраняется', async () => {
    const savings = await createSavings('Копилка', Money.fromMajor(3_000))
    await transactionsRepository.create({ type: 'transfer', amount: Money.fromMajor(2_000), fromAccountId: card, toAccountId: savings, date: '2026-09-20', note: '' })
    await transactionsRepository.create({ type: 'expense', amount: Money.fromMajor(500), categoryId: C.groceries, accountId: savings, date: '2026-09-21', note: '' })
    const goal = await goalsRepository.create(input({ linkedAccountId: savings, currentAmount: null }))

    const result = await accountsRepository.transferAndRemove(savings, card)

    expect(result.goals).toBe(1)
    const detached = await goalsRepository.get(goal.id)
    expect(detached?.linkedAccountId).toBeUndefined()
    // 3 000 + 2 000 − 500: остаток на момент удаления
    expect(detached?.currentAmount).toBe(Money.fromMajor(4_500))
  })

  it('явный выбор «оставить без счёта» работает и при переносе на накопительный', async () => {
    const first = await createSavings('Первый', Money.fromMajor(700))
    const second = await createSavings('Второй')
    await transactionsRepository.create({ type: 'transfer', amount: Money.fromMajor(100), fromAccountId: card, toAccountId: first, date: '2026-09-20', note: '' })
    const goal = await goalsRepository.create(input({ linkedAccountId: first, currentAmount: null }))

    await accountsRepository.transferAndRemove(first, second, { goals: 'unlink' })

    expect(await goalsRepository.get(goal.id)).toMatchObject({ currentAmount: Money.fromMajor(800) })
    expect((await goalsRepository.get(goal.id))?.linkedAccountId).toBeUndefined()
  })

  it('перевязать на карту нельзя', async () => {
    const savings = await createSavings()
    await transactionsRepository.create({ type: 'transfer', amount: Money.fromMajor(100), fromAccountId: card, toAccountId: savings, date: '2026-09-20', note: '' })
    await goalsRepository.create(input({ linkedAccountId: savings, currentAmount: null }))

    await expect(accountsRepository.transferAndRemove(savings, card, { goals: 'relink' })).rejects.toThrow('накопительным')
    expect(await db.accounts.get(savings)).toBeDefined()
  })

  it('удаление пустого счёта оставляет цель без счёта с начальным остатком как накопленным', async () => {
    const savings = await createSavings('Копилка', Money.fromMajor(1_500))
    const goal = await goalsRepository.create(input({ linkedAccountId: savings, currentAmount: null }))

    expect((await accountsRepository.countUsage(savings)).goals).toBe(1)
    await accountsRepository.remove(savings)

    expect(await goalsRepository.get(goal.id)).toMatchObject({ currentAmount: Money.fromMajor(1_500) })
    expect((await goalsRepository.get(goal.id))?.linkedAccountId).toBeUndefined()
  })
})
