import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Account, Budget, Category, EntryTransaction } from '../types/entities'
import { Money } from '../utils/money'
import { BudgetDatabase, db, DB_NAME, DB_VERSION } from './database'
import { SCHEMA_V1 } from './schema'

/**
 * Проверяем реальный путь обновления: база версии 1 с данными пользователя
 * открывается кодом версии 2. Ни одна запись не должна пропасть.
 */

const V1_ACCOUNT: Account = {
  id: 'acc-card',
  name: 'Карта',
  type: 'card',
  initialBalance: Money.fromMajor(1_500),
  currency: 'UAH',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
}

const V1_CATEGORY: Category = {
  id: 'cat-exp-groceries',
  name: 'Продукты',
  icon: '🛒',
  type: 'expense',
  isSystem: true,
  createdAt: 1_700_000_000_000,
}

const V1_TRANSACTIONS: EntryTransaction[] = [
  {
    id: 'tx-1',
    type: 'expense',
    amount: Money.fromMajor(430),
    categoryId: V1_CATEGORY.id,
    accountId: V1_ACCOUNT.id,
    date: '2026-08-14',
    note: 'АТБ',
    createdAt: 1_700_000_001_000,
    updatedAt: 1_700_000_001_000,
  },
  {
    id: 'tx-2',
    type: 'income',
    amount: Money.fromMajor(32_000),
    categoryId: 'cat-inc-salary',
    accountId: V1_ACCOUNT.id,
    date: '2026-08-01',
    note: '',
    createdAt: 1_700_000_002_000,
    updatedAt: 1_700_000_002_000,
  },
]

/** Бюджет v0.1 с лимитами категорий внутри — их v2 переносит в отдельную таблицу. */
const V1_BUDGET: Budget = {
  id: '2026-08',
  year: 2026,
  month: 8,
  totalLimit: Money.fromMajor(15_000),
  categoryLimits: [
    { categoryId: V1_CATEGORY.id, limit: Money.fromMajor(5_000) },
    { categoryId: 'cat-exp-transport', limit: Money.fromMajor(2_000) },
    // Мусорные записи миграция должна пропустить, а не упасть на них
    { categoryId: 'cat-exp-cafe', limit: 0 },
  ],
}

async function writeV1Database(): Promise<void> {
  const legacy = new Dexie(DB_NAME)
  legacy.version(1).stores(SCHEMA_V1)
  await legacy.open()
  await Promise.all([
    legacy.table('accounts').add(V1_ACCOUNT),
    legacy.table('categories').add(V1_CATEGORY),
    legacy.table('transactions').bulkAdd(V1_TRANSACTIONS),
    legacy.table('budgets').add(V1_BUDGET),
    legacy.table('settings').add({ id: 'app', baseCurrency: 'UAH', theme: 'system', lastAccountId: V1_ACCOUNT.id }),
  ])
  legacy.close()
}

/** Открывает базу свежим экземпляром кода v2 — так же, как это делает приложение после обновления. */
async function openUpgraded(): Promise<BudgetDatabase> {
  const upgraded = new BudgetDatabase(DB_NAME)
  await upgraded.open()
  return upgraded
}

beforeEach(async () => {
  db.close()
  await Dexie.delete(DB_NAME)
})

describe('миграция v1 → v2', () => {
  it('поднимает версию базы до последней', async () => {
    await writeV1Database()
    const upgraded = await openUpgraded()

    expect(DB_VERSION).toBe(3)
    expect(upgraded.verno).toBe(3)
    upgraded.close()
  })

  it('сохраняет все счета, категории, операции, бюджет и настройки', async () => {
    await writeV1Database()
    const upgraded = await openUpgraded()

    expect(await upgraded.accounts.toArray()).toEqual([V1_ACCOUNT])
    expect(await upgraded.categories.toArray()).toEqual([V1_CATEGORY])
    expect((await upgraded.transactions.toArray()).sort((a, b) => a.id.localeCompare(b.id))).toEqual(V1_TRANSACTIONS)
    expect((await upgraded.settings.get('app'))?.lastAccountId).toBe(V1_ACCOUNT.id)

    const budget = await upgraded.budgets.get(V1_BUDGET.id)
    expect(budget?.totalLimit).toBe(V1_BUDGET.totalLimit)
    upgraded.close()
  })

  it('переносит лимиты категорий в categoryBudgets и убирает устаревшее поле', async () => {
    await writeV1Database()
    const upgraded = await openUpgraded()

    const limits = await upgraded.categoryBudgets.orderBy('id').toArray()
    expect(limits).toHaveLength(2)
    expect(limits.map((item) => [item.categoryId, item.limitAmount])).toEqual([
      ['cat-exp-groceries', Money.fromMajor(5_000)],
      ['cat-exp-transport', Money.fromMajor(2_000)],
    ])
    expect(limits.every((item) => item.year === 2026 && item.month === 8)).toBe(true)

    expect((await upgraded.budgets.get(V1_BUDGET.id))?.categoryLimits).toBeUndefined()
    upgraded.close()
  })

  it('повторное открытие ничего не задваивает и не теряет', async () => {
    await writeV1Database()
    const first = await openUpgraded()
    const snapshot = await first.categoryBudgets.orderBy('id').toArray()
    first.close()

    const second = await openUpgraded()
    expect(await second.categoryBudgets.orderBy('id').toArray()).toEqual(snapshot)
    expect(await second.transactions.count()).toBe(V1_TRANSACTIONS.length)
    second.close()
  })

  it('переживает бюджет без лимитов категорий', async () => {
    const legacy = new Dexie(DB_NAME)
    legacy.version(1).stores(SCHEMA_V1)
    await legacy.open()
    await legacy.table('budgets').add({ id: '2026-07', year: 2026, month: 7, totalLimit: Money.fromMajor(10_000) })
    legacy.close()

    const upgraded = await openUpgraded()
    expect(await upgraded.categoryBudgets.count()).toBe(0)
    expect((await upgraded.budgets.get('2026-07'))?.totalLimit).toBe(Money.fromMajor(10_000))
    upgraded.close()
  })

  it('на пустом устройстве создаёт базу сразу последней версии со значениями по умолчанию', async () => {
    const fresh = await openUpgraded()

    expect(fresh.verno).toBe(DB_VERSION)
    expect(await fresh.accounts.count()).toBe(2)
    expect(await fresh.categories.count()).toBeGreaterThan(0)
    expect(await fresh.settings.get('app')).toBeDefined()
    fresh.close()
  })
})
