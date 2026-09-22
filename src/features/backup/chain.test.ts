import { beforeEach, describe, expect, it } from 'vitest'
import { db, DB_VERSION } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import { Money } from '../../utils/money'
import { calculateTotalBalance } from '../transactions/calculations'
import { BACKUP_SCHEMA_VERSION } from './format'
import { parseBackup } from './parse'
import { createBackup, restoreBackup, serializeBackup } from './repository'

/**
 * Сквозные цепочки (ТЗ §71): копия каждой прошлой версии → разбор → база
 * текущей версии. Проверяется одно и то же: ни одна операция не потерялась,
 * общий баланс тот же, а новые поля получили значения по умолчанию.
 */

const ACCOUNTS = [
  { id: 'card', name: 'Карта', type: 'card', initialBalance: 100_000, currency: 'UAH', createdAt: 1, updatedAt: 1 },
  { id: 'cash', name: 'Наличные', type: 'cash', initialBalance: 5_000, currency: 'UAH', createdAt: 2, updatedAt: 2 },
]

const CATEGORIES = [
  { id: 'cat-exp-groceries', name: 'Продукты', icon: '🛒', type: 'expense', isSystem: true, createdAt: 1 },
  { id: 'cat-inc-salary', name: 'Зарплата', icon: '💰', type: 'income', isSystem: true, createdAt: 3 },
]

const ENTRIES = [
  { id: 't-1', type: 'expense', amount: 43_000, categoryId: 'cat-exp-groceries', accountId: 'card', date: '2026-08-14', note: 'АТБ', createdAt: 10, updatedAt: 10 },
  { id: 't-2', type: 'income', amount: 3_200_000, categoryId: 'cat-inc-salary', accountId: 'card', date: '2026-08-01', note: '', createdAt: 11, updatedAt: 11 },
]

const TRANSFER = { id: 't-3', type: 'transfer', amount: 40_000, fromAccountId: 'card', toAccountId: 'cash', date: '2026-08-20', note: '', createdAt: 12, updatedAt: 12 }

const RULE = { id: 'r-1', type: 'expense', amount: 19_900, categoryId: 'cat-exp-groceries', accountId: 'card', note: 'Spotify', frequency: 'monthly', interval: 1, startDate: '2026-08-14', nextOccurrence: '2026-10-14', isActive: true, createdAt: 11, updatedAt: 11 }

const SETTINGS = { id: 'app', baseCurrency: 'UAH', theme: 'system', lastAccountId: 'card' }

/** Баланс, который должен получиться из любой версии: 1 000 + 50 + 32 000 − 430 = 32 620 ₴. */
const EXPECTED_BALANCE = Money.fromMajor(32_620)

const file = (schemaVersion: number, data: Record<string, unknown>) =>
  JSON.stringify({ app: 'budget', schemaVersion, exportDate: '2026-09-21T10:00:00.000Z', appVersion: `0.${schemaVersion}.0`, data })

const V1 = file(1, {
  accounts: ACCOUNTS,
  categories: CATEGORIES,
  transactions: ENTRIES,
  budgets: [{ id: '2026-08', year: 2026, month: 8, totalLimit: 1_500_000, categoryLimits: [{ categoryId: 'cat-exp-groceries', limit: 500_000 }] }],
  settings: SETTINGS,
})

const V2 = file(2, {
  accounts: ACCOUNTS,
  categories: CATEGORIES,
  transactions: [...ENTRIES, TRANSFER],
  budgets: [{ id: '2026-08', year: 2026, month: 8, totalLimit: 1_500_000 }],
  categoryBudgets: [{ id: '2026-08:cat-exp-groceries', categoryId: 'cat-exp-groceries', year: 2026, month: 8, limitAmount: 500_000, createdAt: 1, updatedAt: 1 }],
  recurringTransactions: [RULE],
  settings: SETTINGS,
})

const V3 = file(3, {
  accounts: ACCOUNTS,
  categories: CATEGORIES,
  transactions: [...ENTRIES, TRANSFER],
  budgets: [],
  categoryBudgets: [],
  recurringTransactions: [
    RULE,
    { id: 'r-2', type: 'transfer', amount: 200_000, fromAccountId: 'card', toAccountId: 'cash', note: 'На накопительный', frequency: 'monthly', interval: 1, startDate: '2026-08-25', nextOccurrence: '2026-10-25', isActive: true, createdAt: 12, updatedAt: 12 },
  ],
  settings: { ...SETTINGS, lastBackupAt: 1_700_000_000_000, backupReminderSnoozedUntil: null },
})

const V4 = file(4, {
  accounts: ACCOUNTS,
  categories: CATEGORIES,
  transactions: [...ENTRIES, TRANSFER, { id: 't-4', type: 'adjustment', amount: 1_000, direction: 'decrease', accountId: 'cash', date: '2026-09-01', note: '', createdAt: 13, updatedAt: 13 }],
  budgets: [],
  categoryBudgets: [],
  recurringTransactions: [{ ...RULE, executionMode: 'confirm', nextOccurrence: '2026-10-14' }],
  pendingOccurrences: [{ id: 'p-1', recurringId: 'r-1', scheduledDate: '2026-09-14', status: 'pending', createdAt: 14, updatedAt: 14 }],
  settings: { ...SETTINGS, lastBackupAt: null, backupReminderSnoozedUntil: null },
})

const V5 = file(5, {
  accounts: [...ACCOUNTS, { id: 'savings', name: 'Копилка', type: 'savings', initialBalance: 200_000, currency: 'UAH', createdAt: 3, updatedAt: 3 }],
  categories: CATEGORIES,
  transactions: [...ENTRIES, TRANSFER],
  budgets: [{ id: '2026-08', year: 2026, month: 8, totalLimit: 1_500_000 }],
  categoryBudgets: [
    { id: '2026-08:cat-exp-groceries', categoryId: 'cat-exp-groceries', year: 2026, month: 8, limitAmount: 500_000, rollover: true, createdAt: 1, updatedAt: 1 },
  ],
  recurringTransactions: [{ ...RULE, executionMode: 'automatic' }],
  pendingOccurrences: [],
  savingsGoals: [
    { id: 'goal-1', name: 'MacBook', icon: '💻', targetAmount: 8_000_000, targetDate: '2026-12-31', linkedAccountId: 'savings', isArchived: false, createdAt: 4, updatedAt: 4 },
    { id: 'goal-2', name: 'Отпуск', icon: '🏖️', targetAmount: 3_000_000, currentAmount: 750_000, isArchived: true, createdAt: 5, updatedAt: 5 },
    // Счёт этой цели в копии отсутствует: ремонт оставит её без счёта
    { id: 'goal-3', name: 'Без счёта', icon: '🎯', targetAmount: 100_000, linkedAccountId: 'acc-gone', isArchived: false, createdAt: 6, updatedAt: 6 },
  ],
  budgetTemplates: [
    {
      id: 'tpl-1',
      name: 'Обычный месяц',
      totalLimit: 2_000_000,
      categoryLimits: [
        { categoryId: 'cat-exp-groceries', limitAmount: 600_000 },
        { categoryId: 'cat-gone', limitAmount: 100 },
      ],
      createdAt: 7,
      updatedAt: 7,
    },
  ],
  settings: { ...SETTINGS, lastBackupAt: null, backupReminderSnoozedUntil: null },
})

async function restoreFile(text: string) {
  const parsed = parseBackup(text)
  if (!parsed.ok) throw new Error(parsed.error)
  await restoreBackup(parsed.data)
  return parsed
}

beforeEach(resetTestDatabase)

describe('цепочки копий до текущей версии', () => {
  it('свежая установка сразу на последней схеме', () => {
    expect(db.verno).toBe(DB_VERSION)
    expect(DB_VERSION).toBe(6)
    expect(BACKUP_SCHEMA_VERSION).toBe(5)
  })

  it('копия 0.1 → текущая база: лимиты переехали, баланс тот же', async () => {
    const parsed = await restoreFile(V1)
    expect(parsed.migrationSteps).toEqual([2, 3, 4, 5])

    expect(await db.transactions.count()).toBe(2)
    expect(calculateTotalBalance(await db.accounts.toArray(), await db.transactions.toArray())).toBe(EXPECTED_BALANCE)
    expect((await db.categoryBudgets.toArray()).map((item) => [item.categoryId, item.limitAmount])).toEqual([
      ['cat-exp-groceries', 500_000],
    ])
    expect((await db.budgets.get('2026-08'))?.categoryLimits).toBeUndefined()
    expect(await db.pendingOccurrences.count()).toBe(0)
  })

  it('копия 0.2 → текущая база: расписание стало автоматическим', async () => {
    const parsed = await restoreFile(V2)
    expect(parsed.migrationSteps).toEqual([3, 4, 5])

    expect(await db.transactions.count()).toBe(3)
    expect(calculateTotalBalance(await db.accounts.toArray(), await db.transactions.toArray())).toBe(EXPECTED_BALANCE)
    expect((await db.recurringTransactions.get('r-1'))?.executionMode).toBe('automatic')
    expect((await db.categoryBudgets.toArray())).toHaveLength(1)
  })

  it('копия 0.3 → текущая база: регулярный перевод и настройки на месте', async () => {
    const parsed = await restoreFile(V3)
    expect(parsed.migrationSteps).toEqual([4, 5])

    expect(calculateTotalBalance(await db.accounts.toArray(), await db.transactions.toArray())).toBe(EXPECTED_BALANCE)
    const rules = await db.recurringTransactions.orderBy('id').toArray()
    expect(rules.map((rule) => [rule.id, rule.type, rule.executionMode])).toEqual([
      ['r-1', 'expense', 'automatic'],
      ['r-2', 'transfer', 'automatic'],
    ])
    expect((await db.settings.get('app'))?.lastBackupAt).toBe(1_700_000_000_000)
  })

  it('копия 0.4 → текущая база: корректировка, режим и вхождение переносятся как есть', async () => {
    const parsed = await restoreFile(V4)
    expect(parsed.migrationSteps).toEqual([5])

    // Корректировка −10 ₴ на наличных
    expect(calculateTotalBalance(await db.accounts.toArray(), await db.transactions.toArray())).toBe(
      EXPECTED_BALANCE - Money.fromMajor(10),
    )
    expect((await db.recurringTransactions.get('r-1'))?.executionMode).toBe('confirm')
    expect(await db.pendingOccurrences.get('p-1')).toMatchObject({ recurringId: 'r-1', status: 'pending' })
  })

  it('копия 0.5 → текущая база: цели, шаблоны и перенос остатка на месте, битые ссылки починены', async () => {
    const parsed = await restoreFile(V5)
    expect(parsed.migrationSteps).toEqual([])
    expect(parsed.danglingReferences).toBe(1)

    expect((await db.categoryBudgets.get('2026-08:cat-exp-groceries'))?.rollover).toBe(true)
    expect(await db.savingsGoals.get('goal-1')).toMatchObject({ linkedAccountId: 'savings', targetAmount: 8_000_000 })
    expect(await db.savingsGoals.get('goal-2')).toMatchObject({ currentAmount: 750_000, isArchived: true })
    const orphan = await db.savingsGoals.get('goal-3')
    expect(orphan?.linkedAccountId).toBeUndefined()
    expect(orphan?.currentAmount).toBe(0)
    expect((await db.budgetTemplates.get('tpl-1'))?.categoryLimits).toEqual([
      { categoryId: 'cat-exp-groceries', limitAmount: 600_000 },
    ])
    // Общий баланс: 32 620 + 2 000 начального остатка копилки
    expect(calculateTotalBalance(await db.accounts.toArray(), await db.transactions.toArray())).toBe(
      EXPECTED_BALANCE + Money.fromMajor(2_000),
    )
  })

  it('копия текущей базы читается назад без изменений', async () => {
    await restoreFile(V5)
    const before = {
      transactions: await db.transactions.orderBy('id').toArray(),
      rules: await db.recurringTransactions.orderBy('id').toArray(),
      pending: await db.pendingOccurrences.orderBy('id').toArray(),
      goals: await db.savingsGoals.orderBy('id').toArray(),
      templates: await db.budgetTemplates.orderBy('id').toArray(),
      limits: await db.categoryBudgets.orderBy('id').toArray(),
    }

    const text = serializeBackup(await createBackup(new Date(2026, 8, 21), '0.5.0'))
    await resetTestDatabase()
    await restoreFile(text)

    expect(await db.transactions.orderBy('id').toArray()).toEqual(before.transactions)
    expect(await db.recurringTransactions.orderBy('id').toArray()).toEqual(before.rules)
    expect(await db.pendingOccurrences.orderBy('id').toArray()).toEqual(before.pending)
    expect(await db.savingsGoals.orderBy('id').toArray()).toEqual(before.goals)
    expect(await db.budgetTemplates.orderBy('id').toArray()).toEqual(before.templates)
    expect(await db.categoryBudgets.orderBy('id').toArray()).toEqual(before.limits)
  })

  it('отказывается от копии с двумя лимитами на одну категорию в шаблоне', () => {
    const parsed = parseBackup(
      file(5, {
        accounts: ACCOUNTS,
        categories: CATEGORIES,
        transactions: [],
        budgetTemplates: [
          {
            id: 'tpl',
            name: 'Дубль',
            totalLimit: 0,
            categoryLimits: [
              { categoryId: 'cat-exp-groceries', limitAmount: 100 },
              { categoryId: 'cat-exp-groceries', limitAmount: 200 },
            ],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        settings: SETTINGS,
      }),
    )
    expect(parsed).toMatchObject({ ok: false, error: expect.stringContaining('повторяющиеся') })
  })

  it('копия более новой версии отклоняется с понятным сообщением', () => {
    const parsed = parseBackup(file(BACKUP_SCHEMA_VERSION + 1, { accounts: ACCOUNTS }))
    expect(parsed).toMatchObject({ ok: false, error: expect.stringContaining('обновите приложение') })
  })
})
