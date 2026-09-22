import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { calculateTotalBalance } from '../features/transactions/calculations'
import type { Account, Category, RecurringEntry, Transaction } from '../types/entities'
import { Money } from '../utils/money'
import { BudgetDatabase, db, DB_NAME } from './database'
import { RECOVERED_ACCOUNT_ID, repairDanglingReferences } from './repair'
import { SCHEMA_V1, SCHEMA_V2 } from './schema'

/**
 * Баг v0.2 мог оставить в базе операции и правила на удалённый счёт.
 * Миграция v3 обязана их починить, ничего не удаляя.
 */

const CARD: Account = {
  id: 'acc-card',
  name: 'Карта',
  type: 'card',
  initialBalance: Money.fromMajor(1_000),
  currency: 'UAH',
  createdAt: 1,
  updatedAt: 1,
}

const GROCERIES: Category = {
  id: 'cat-exp-groceries',
  name: 'Продукты',
  icon: '🛒',
  type: 'expense',
  isSystem: true,
  createdAt: 1,
}

const OTHER: Category = {
  id: 'cat-exp-other',
  name: 'Другое',
  icon: '📦',
  type: 'expense',
  isSystem: true,
  createdAt: 2,
}

/** Операция на счёт, которого уже нет, — след сработавшего бага. */
const ORPHAN: Transaction = {
  id: 'tx-orphan',
  type: 'expense',
  amount: Money.fromMajor(430),
  categoryId: GROCERIES.id,
  accountId: 'acc-deleted',
  date: '2026-08-14',
  note: 'АТБ',
  createdAt: 2,
  updatedAt: 2,
}

const ORPHAN_RULE: RecurringEntry = {
  id: 'rule-orphan',
  type: 'expense',
  amount: Money.fromMajor(199),
  categoryId: GROCERIES.id,
  accountId: 'acc-deleted',
  note: 'Spotify',
  frequency: 'monthly',
  interval: 1,
  startDate: '2026-08-14',
  nextOccurrence: '2026-09-14',
  isActive: true,
  executionMode: 'automatic',
  createdAt: 3,
  updatedAt: 3,
}

/** База версии 2 — такая, какой её оставила бы v0.2. */
async function writeV2Database(rows: {
  transactions?: Transaction[]
  recurring?: RecurringEntry[]
}): Promise<void> {
  const legacy = new Dexie(DB_NAME)
  legacy.version(1).stores(SCHEMA_V1)
  legacy.version(2).stores(SCHEMA_V2)
  await legacy.open()
  await Promise.all([
    legacy.table('accounts').add(CARD),
    legacy.table('categories').bulkAdd([GROCERIES, OTHER]),
    legacy.table('transactions').bulkAdd(rows.transactions ?? []),
    legacy.table('recurringTransactions').bulkAdd(rows.recurring ?? []),
    legacy.table('settings').add({ id: 'app', baseCurrency: 'UAH', theme: 'system', lastAccountId: CARD.id }),
  ])
  legacy.close()
}

async function openUpgraded(): Promise<BudgetDatabase> {
  const upgraded = new BudgetDatabase(DB_NAME)
  await upgraded.open()
  return upgraded
}

beforeEach(async () => {
  db.close()
  await Dexie.delete(DB_NAME)
})

describe('миграция v2 → v3', () => {
  it('переносит потерянные операции и правила на «Восстановленный счёт»', async () => {
    await writeV2Database({ transactions: [ORPHAN], recurring: [ORPHAN_RULE] })

    const upgraded = await openUpgraded()

    const recovered = await upgraded.accounts.get(RECOVERED_ACCOUNT_ID)
    expect(recovered?.name).toBe('Восстановленный счёт')
    expect(recovered?.currency).toBe('UAH')

    const transaction = await upgraded.transactions.get(ORPHAN.id)
    expect(transaction && 'accountId' in transaction && transaction.accountId).toBe(RECOVERED_ACCOUNT_ID)

    const rule = await upgraded.recurringTransactions.get(ORPHAN_RULE.id)
    expect(rule && 'accountId' in rule && rule.accountId).toBe(RECOVERED_ACCOUNT_ID)
    // Правило выключено: куда его направить — решает пользователь
    expect(rule?.isActive).toBe(false)

    upgraded.close()
  })

  it('не теряет ни одной операции и не меняет общий баланс', async () => {
    const own: Transaction = { ...ORPHAN, id: 'tx-own', accountId: CARD.id, amount: Money.fromMajor(100) }
    await writeV2Database({ transactions: [ORPHAN, own] })

    const upgraded = await openUpgraded()

    expect(await upgraded.transactions.count()).toBe(2)
    // Операция «потерянного» счёта теперь учитывается на восстановленном,
    // начальный остаток которого ноль — общая сумма сходится
    const balance = calculateTotalBalance(await upgraded.accounts.toArray(), await upgraded.transactions.toArray())
    expect(balance).toBe(Money.fromMajor(1_000 - 430 - 100))

    upgraded.close()
  })

  it('на чистой базе не создаёт «Восстановленный счёт»', async () => {
    await writeV2Database({ transactions: [{ ...ORPHAN, accountId: CARD.id }] })

    const upgraded = await openUpgraded()

    expect(await upgraded.accounts.get(RECOVERED_ACCOUNT_ID)).toBeUndefined()
    expect(await upgraded.accounts.count()).toBe(1)
    upgraded.close()
  })

  it('чинит битую категорию, подставляя «Другое»', async () => {
    await writeV2Database({ transactions: [{ ...ORPHAN, accountId: CARD.id, categoryId: 'cat-deleted' }] })

    const upgraded = await openUpgraded()

    const transaction = await upgraded.transactions.get(ORPHAN.id)
    expect(transaction && 'categoryId' in transaction && transaction.categoryId).toBe(OTHER.id)
    upgraded.close()
  })

  it('чинит операцию, у которой битые и счёт, и категория', async () => {
    await writeV2Database({ transactions: [{ ...ORPHAN, categoryId: 'cat-deleted' }] })

    const upgraded = await openUpgraded()

    const transaction = await upgraded.transactions.get(ORPHAN.id)
    expect(transaction && 'accountId' in transaction && transaction.accountId).toBe(RECOVERED_ACCOUNT_ID)
    expect(transaction && 'categoryId' in transaction && transaction.categoryId).toBe(OTHER.id)
    upgraded.close()
  })

  it('чинит битую категорию и у правила, не останавливая его', async () => {
    // Счёт у правила живой — ломается только категория
    await writeV2Database({
      recurring: [{ ...ORPHAN_RULE, accountId: CARD.id, categoryId: 'cat-deleted' }],
    })

    const upgraded = await openUpgraded()

    const rule = await upgraded.recurringTransactions.get(ORPHAN_RULE.id)
    expect(rule && 'categoryId' in rule && rule.categoryId).toBe(OTHER.id)
    // Из-за одной категории расписание останавливать не за что
    expect(rule?.isActive).toBe(true)
    // И «Восстановленный счёт» ради этого не создаётся
    expect(await upgraded.accounts.get(RECOVERED_ACCOUNT_ID)).toBeUndefined()

    upgraded.close()
  })

  it('чинит правило с битыми счётом и категорией одной записью', async () => {
    await writeV2Database({ recurring: [{ ...ORPHAN_RULE, categoryId: 'cat-deleted' }] })

    const upgraded = await openUpgraded()

    const rule = await upgraded.recurringTransactions.get(ORPHAN_RULE.id)
    expect(rule && 'accountId' in rule && rule.accountId).toBe(RECOVERED_ACCOUNT_ID)
    expect(rule && 'categoryId' in rule && rule.categoryId).toBe(OTHER.id)
    // Битый счёт правило останавливает — в отличие от одной лишь категории
    expect(rule?.isActive).toBe(false)

    upgraded.close()
  })
})

describe('повторный ремонт', () => {
  it('на уже починенной базе ничего не меняет', async () => {
    await writeV2Database({ transactions: [ORPHAN], recurring: [ORPHAN_RULE] })
    const upgraded = await openUpgraded()

    const before = {
      accounts: await upgraded.accounts.toArray(),
      transactions: await upgraded.transactions.toArray(),
      rules: await upgraded.recurringTransactions.toArray(),
    }

    const summary = await upgraded.transaction(
      'rw',
      [
        upgraded.accounts,
        upgraded.categories,
        upgraded.transactions,
        upgraded.recurringTransactions,
        upgraded.settings,
      ],
      (tx) => repairDanglingReferences(tx),
    )

    expect(summary).toEqual({
      transactions: 0,
      recurring: 0,
      categories: 0,
      recurringCategories: 0,
      createdRecoveredAccount: false,
      systemCategories: 0,
      orphanOccurrences: 0,
      goals: 0,
      templateLimits: 0,
    })
    expect(await upgraded.accounts.toArray()).toEqual(before.accounts)
    expect(await upgraded.transactions.toArray()).toEqual(before.transactions)
    expect(await upgraded.recurringTransactions.toArray()).toEqual(before.rules)

    upgraded.close()
  })

  it('переиспользует уже существующий «Восстановленный счёт»', async () => {
    await writeV2Database({ transactions: [ORPHAN] })
    const upgraded = await openUpgraded()

    // Ещё одна потерянная операция появилась позже
    await upgraded.transactions.add({ ...ORPHAN, id: 'tx-orphan-2', accountId: 'acc-gone' })

    const summary = await upgraded.transaction(
      'rw',
      [
        upgraded.accounts,
        upgraded.categories,
        upgraded.transactions,
        upgraded.recurringTransactions,
        upgraded.settings,
      ],
      (tx) => repairDanglingReferences(tx),
    )

    expect(summary.createdRecoveredAccount).toBe(false)
    expect(summary.transactions).toBe(1)
    expect(await upgraded.accounts.where('id').equals(RECOVERED_ACCOUNT_ID).count()).toBe(1)

    upgraded.close()
  })
})

describe('ожидающие вхождения без расписания (0.4)', () => {
  it('снимаются ремонтом, а вхождения живых расписаний остаются', async () => {
    await writeV2Database({ recurring: [{ ...ORPHAN_RULE, id: 'rule-alive', accountId: CARD.id }] })
    const upgraded = await openUpgraded()

    await upgraded.pendingOccurrences.bulkAdd([
      { id: 'p-alive', recurringId: 'rule-alive', scheduledDate: '2026-09-14', status: 'pending', createdAt: 1, updatedAt: 1 },
      { id: 'p-orphan', recurringId: 'rule-gone', scheduledDate: '2026-09-14', status: 'pending', createdAt: 1, updatedAt: 1 },
      { id: 'p-orphan-done', recurringId: 'rule-gone', scheduledDate: '2026-08-14', status: 'confirmed', createdAt: 1, updatedAt: 1 },
    ])

    const summary = await upgraded.transaction(
      'rw',
      [
        upgraded.accounts,
        upgraded.categories,
        upgraded.transactions,
        upgraded.recurringTransactions,
        upgraded.pendingOccurrences,
        upgraded.settings,
      ],
      (tx) => repairDanglingReferences(tx),
    )

    expect(summary.orphanOccurrences).toBe(2)
    expect((await upgraded.pendingOccurrences.toArray()).map((item) => item.id)).toEqual(['p-alive'])
    upgraded.close()
  })

  it('без таблицы вхождений в транзакции ремонт её не трогает', async () => {
    await writeV2Database({ transactions: [ORPHAN] })
    const upgraded = await openUpgraded()

    const summary = await upgraded.transaction(
      'rw',
      [upgraded.accounts, upgraded.categories, upgraded.transactions, upgraded.recurringTransactions, upgraded.settings],
      (tx) => repairDanglingReferences(tx),
    )

    expect(summary.orphanOccurrences).toBe(0)
    upgraded.close()
  })
})
