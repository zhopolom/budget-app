import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import type { Category, Id } from '../../types/entities'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { categoryBudgetsRepository } from '../budgets/repository'
import { recurringRepository } from '../recurring/repository'
import { transactionsRepository } from '../transactions/repository'
import { SYSTEM_CATEGORY_IDS as C } from './defaults'
import { categoriesRepository } from './repository'

const { card } = DEFAULT_ACCOUNT_IDS
const SEPTEMBER = { year: 2026, month: 9 }

async function customCategory(name = 'Кофейни'): Promise<Category> {
  return categoriesRepository.create({ name, icon: '☕', type: 'expense' })
}

async function addExpense(categoryId: Id, amount = 100): Promise<void> {
  await transactionsRepository.create({
    type: 'expense',
    amount: Money.fromMajor(amount),
    categoryId,
    accountId: card,
    date: '2026-09-21',
    note: '',
  })
}

beforeEach(resetTestDatabase)

describe('categoriesRepository.remove', () => {
  it('удаляет неиспользуемую категорию вместе с её лимитами', async () => {
    const category = await customCategory()
    await categoryBudgetsRepository.set(SEPTEMBER, category.id, Money.fromMajor(1_000))

    await categoriesRepository.remove(category.id)

    expect(await db.categories.get(category.id)).toBeUndefined()
    expect(await categoryBudgetsRepository.listAll()).toHaveLength(0)
  })

  it('не удаляет категорию, на которую ссылаются операции', async () => {
    const category = await customCategory()
    await addExpense(category.id)

    await expect(categoriesRepository.remove(category.id)).rejects.toThrow('используется')
    expect(await db.categories.get(category.id)).toBeDefined()
    expect(await db.transactions.count()).toBe(1)
  })

  it('не удаляет категорию, занятую регулярной операцией', async () => {
    const category = await customCategory()
    await recurringRepository.create(
      {
        type: 'expense',
        amount: Money.fromMajor(199),
        categoryId: category.id,
        accountId: card,
        note: 'Кофе',
        frequency: 'monthly',
        interval: 1,
        startDate: '2026-09-01',
      },
      '2026-09-21',
    )

    await expect(categoriesRepository.remove(category.id)).rejects.toThrow('используется')
  })

  it('системные категории не удаляются', async () => {
    await expect(categoriesRepository.remove(C.groceries)).rejects.toThrow('Системные')
  })
})

describe('categoriesRepository.replaceAndRemove', () => {
  it('переносит операции на другую категорию и удаляет исходную', async () => {
    const category = await customCategory()
    await addExpense(category.id, 100)
    await addExpense(category.id, 250)
    await addExpense(C.groceries, 40)

    const moved = await categoriesRepository.replaceAndRemove(category.id, C.groceries)

    expect(moved).toBe(2)
    expect(await db.categories.get(category.id)).toBeUndefined()
    expect(await db.transactions.where('categoryId').equals(C.groceries).count()).toBe(3)
    expect(await db.transactions.count()).toBe(3)
  })

  it('переносит и регулярные операции — иначе они остались бы с битой категорией', async () => {
    const category = await customCategory()
    const recurring = await recurringRepository.create(
      {
        type: 'expense',
        amount: Money.fromMajor(199),
        categoryId: category.id,
        accountId: card,
        note: 'Кофе',
        frequency: 'monthly',
        interval: 1,
        startDate: '2026-09-01',
      },
      '2026-09-21',
    )

    await categoriesRepository.replaceAndRemove(category.id, C.cafe)

    const moved = await db.recurringTransactions.get(recurring.id)
    expect(moved && 'categoryId' in moved && moved.categoryId).toBe(C.cafe)
  })

  it('снимает лимиты удаляемой категории и не трогает чужие', async () => {
    const category = await customCategory()
    await addExpense(category.id)
    await categoryBudgetsRepository.set(SEPTEMBER, category.id, Money.fromMajor(1_000))
    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(5_000))

    await categoriesRepository.replaceAndRemove(category.id, C.groceries)

    const limits = await categoryBudgetsRepository.listAll()
    expect(limits).toHaveLength(1)
    expect(limits[0].categoryId).toBe(C.groceries)
    // Лимит цели не сложился с лимитом удалённой: бюджет молча меняться не должен
    expect(limits[0].limitAmount).toBe(Money.fromMajor(5_000))
  })

  it('не переносит между категориями разных типов', async () => {
    const category = await customCategory()
    await addExpense(category.id)

    await expect(categoriesRepository.replaceAndRemove(category.id, C.salary)).rejects.toThrow('разных типов')
    expect(await db.categories.get(category.id)).toBeDefined()
  })

  it('не переносит на саму себя и на несуществующую', async () => {
    const category = await customCategory()
    await expect(categoriesRepository.replaceAndRemove(category.id, category.id)).rejects.toThrow('другую')
    await expect(categoriesRepository.replaceAndRemove(category.id, 'missing')).rejects.toThrow('не найдена')
  })

  it('системную категорию удалить нельзя даже с переносом', async () => {
    await expect(categoriesRepository.replaceAndRemove(C.groceries, C.cafe)).rejects.toThrow('Системные')
  })

  it('атомарен: сбой на удалении откатывает и перенос', async () => {
    const category = await customCategory()
    await addExpense(category.id)

    const failOnDelete = () => {
      throw new Error('Сбой при удалении')
    }
    db.categories.hook('deleting', failOnDelete)
    try {
      await expect(categoriesRepository.replaceAndRemove(category.id, C.groceries)).rejects.toThrow()
    } finally {
      db.categories.hook('deleting').unsubscribe(failOnDelete)
    }

    expect(await db.categories.get(category.id)).toBeDefined()
    expect(await db.transactions.where('categoryId').equals(category.id).count()).toBe(1)
  })
})

describe('countUsage', () => {
  it('считает операции и регулярные платежи отдельно', async () => {
    const category = await customCategory()
    await addExpense(category.id)
    await addExpense(category.id)
    await recurringRepository.create(
      {
        type: 'expense',
        amount: Money.fromMajor(199),
        categoryId: category.id,
        accountId: card,
        note: '',
        frequency: 'monthly',
        interval: 1,
        startDate: '2026-09-01',
      },
      '2026-09-21',
    )

    expect(await categoriesRepository.countUsage(category.id)).toEqual({ transactions: 2, recurring: 1 })
  })
})
