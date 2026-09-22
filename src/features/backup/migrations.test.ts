import { describe, expect, it } from 'vitest'
import { BACKUP_SCHEMA_VERSION } from './format'
import {
  backupMigrations,
  migrateBackupData,
  migrateBackupV1ToV2,
  migrateBackupV2ToV3,
  migrateBackupV3ToV4,
  migrateBackupV4ToV5,
} from './migrations'

/**
 * Каждый шаг цепочки — отдельно, на сыром JSON: переносит и добавляет,
 * но не трогает суммы и не отбрасывает записи (это работа разбора).
 */

const V1_BUDGET = {
  id: '2026-08',
  year: 2026,
  month: 8,
  totalLimit: 1_500_000,
  categoryLimits: [
    { categoryId: 'groceries', limit: 500_000 },
    { categoryId: 'transport', limit: 200_000 },
    // Мусор пропускается, а не роняет миграцию
    { categoryId: 'broken', limit: 0 },
    { categoryId: '', limit: 100 },
    { limit: 100 },
    null,
  ],
}

describe('migrateBackupV1ToV2', () => {
  it('переносит лимиты категорий в categoryBudgets с детерминированными id и снимает старое поле', () => {
    const result = migrateBackupV1ToV2({ budgets: [V1_BUDGET], transactions: [{ id: 't', amount: 1 }] })

    expect(result.budgets).toEqual([{ id: '2026-08', year: 2026, month: 8, totalLimit: 1_500_000 }])
    expect(result.categoryBudgets).toEqual([
      expect.objectContaining({ id: '2026-08:groceries', categoryId: 'groceries', year: 2026, month: 8, limitAmount: 500_000 }),
      expect.objectContaining({ id: '2026-08:transport', categoryId: 'transport', limitAmount: 200_000 }),
    ])
    expect(result.recurringTransactions).toEqual([])
    // Остальные разделы проходят как есть
    expect(result.transactions).toEqual([{ id: 't', amount: 1 }])
  })

  it('на данных без лимитов ничего не выдумывает', () => {
    const result = migrateBackupV1ToV2({ budgets: [{ id: '2026-07', year: 2026, month: 7, totalLimit: 100 }] })
    expect(result.categoryBudgets).toEqual([])
    expect(result.budgets).toEqual([{ id: '2026-07', year: 2026, month: 7, totalLimit: 100 }])
  })

  it('не задваивает уже перенесённые лимиты при повторном прогоне', () => {
    const once = migrateBackupV1ToV2({ budgets: [V1_BUDGET] })
    const twice = migrateBackupV1ToV2(once)
    expect(twice.categoryBudgets).toEqual(once.categoryBudgets)
  })

  it('переживает бюджеты не того вида', () => {
    const result = migrateBackupV1ToV2({ budgets: ['мусор', { year: 'нет', categoryLimits: [{ categoryId: 'x', limit: 5 }] }] })
    expect(result.categoryBudgets).toEqual([])
    expect(result.budgets).toHaveLength(2)
  })
})

describe('migrateBackupV2ToV3', () => {
  it('ничего не меняет: регулярные переводы — новый вид записи, а не новое поле', () => {
    const data = { recurringTransactions: [{ id: 'r', type: 'expense' }], accounts: [] }
    expect(migrateBackupV2ToV3(data)).toEqual(data)
  })
})

describe('migrateBackupV3ToV4', () => {
  it('размечает расписания как автоматические и добавляет пустой раздел вхождений', () => {
    const result = migrateBackupV3ToV4({
      recurringTransactions: [{ id: 'a', amount: 100 }, { id: 'b', executionMode: 'confirm' }, 'мусор'],
    })

    expect(result.recurringTransactions).toEqual([
      { id: 'a', amount: 100, executionMode: 'automatic' },
      { id: 'b', executionMode: 'confirm' },
      'мусор',
    ])
    expect(result.pendingOccurrences).toEqual([])
  })

  it('уже существующие вхождения не трогает', () => {
    const pending = [{ id: 'p', recurringId: 'a', scheduledDate: '2026-09-21', status: 'pending' }]
    expect(migrateBackupV3ToV4({ pendingOccurrences: pending }).pendingOccurrences).toEqual(pending)
  })
})

describe('migrateBackupV4ToV5', () => {
  it('заводит пустые разделы целей и шаблонов, лимиты не трогает', () => {
    const limits = [{ id: '2026-08:g', categoryId: 'g', year: 2026, month: 8, limitAmount: 100 }]
    const result = migrateBackupV4ToV5({ categoryBudgets: limits })
    expect(result.savingsGoals).toEqual([])
    expect(result.budgetTemplates).toEqual([])
    expect(result.categoryBudgets).toBe(limits)
  })

  it('существующие цели и шаблоны проходят как есть', () => {
    const goals = [{ id: 'goal', name: 'MacBook' }]
    expect(migrateBackupV4ToV5({ savingsGoals: goals }).savingsGoals).toBe(goals)
  })
})

describe('цепочка', () => {
  it('идёт подряд от 1 до текущей версии', () => {
    expect(backupMigrations.map((step) => [step.from, step.to])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ])
    expect(backupMigrations.at(-1)?.to).toBe(BACKUP_SCHEMA_VERSION)
  })

  it('копия v1 проходит все шаги, актуальная — ни одного', () => {
    const fromV1 = migrateBackupData({ budgets: [V1_BUDGET] }, 1)
    expect(fromV1.steps).toEqual([2, 3, 4, 5])
    expect(fromV1.data.categoryBudgets).toHaveLength(2)
    expect(fromV1.data.pendingOccurrences).toEqual([])
    expect(fromV1.data.savingsGoals).toEqual([])

    const fromV3 = migrateBackupData({ recurringTransactions: [{ id: 'r' }] }, 3)
    expect(fromV3.steps).toEqual([4, 5])
    expect(fromV3.data.recurringTransactions).toEqual([{ id: 'r', executionMode: 'automatic' }])

    const current = migrateBackupData({ accounts: [] }, BACKUP_SCHEMA_VERSION)
    expect(current.steps).toEqual([])
    expect(current.data).toEqual({ accounts: [] })
  })

  it('не меняет исходный объект', () => {
    const source = { budgets: [V1_BUDGET], recurringTransactions: [{ id: 'r' }] }
    const snapshot = JSON.stringify(source)
    migrateBackupData(source, 1)
    expect(JSON.stringify(source)).toBe(snapshot)
  })
})
