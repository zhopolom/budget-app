import { beforeEach, describe, expect, it } from 'vitest'
import { DB_VERSION } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { BACKUP_SCHEMA_VERSION } from '../backup/format'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { transactionsRepository } from '../transactions/repository'
import { describeStorage, readAppInfo } from './appInfo'
import { describeError } from './errors'

beforeEach(resetTestDatabase)

describe('readAppInfo', () => {
  it('отдаёт версии, режим и счётчики — без сумм и заметок', async () => {
    await transactionsRepository.create({ type: 'expense', amount: Money.fromMajor(430), categoryId: C.groceries, accountId: DEFAULT_ACCOUNT_IDS.card, date: '2026-09-21', note: 'АТБ' })

    const info = await readAppInfo('0.6.0')

    expect(info.appVersion).toBe('0.6.0')
    expect(info.dbVersion).toBe(DB_VERSION)
    expect(info.lastMigration).toMatch(/^v6: /)
    expect(info.backupSchemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(info.pwaMode).toBe('browser')
    expect(info.counts).toMatchObject({ transactions: 1, accounts: 2, recurring: 0, pending: 0, goals: 0, rules: 0, imports: 0 })
    expect(info.counts.categories).toBeGreaterThan(0)
    expect(JSON.stringify(info)).not.toContain('АТБ')
    expect(JSON.stringify(info)).not.toContain('43000')
  })
})

describe('describeStorage', () => {
  it('человеческая строка про место и вытеснение', () => {
    expect(describeStorage(null)).toBe('нет данных')
    expect(describeStorage({ usage: 12 * 1024 * 1024, quota: 2048 * 1024 * 1024, persisted: true })).toMatch(/^12 МБ из 2.048 МБ · не вытесняется$/)
    expect(describeStorage({ usage: 0, quota: null, persisted: null })).toBe('1 МБ из ? · сохранение неизвестно')
  })
})

describe('describeError', () => {
  it('имя и короткое сообщение, без стека', () => {
    const error = new RangeError('Сумма операции вне допустимых пределов')
    expect(describeError(error)).toBe('RangeError: Сумма операции вне допустимых пределов')
    expect(describeError(new Error('x'.repeat(500)))).toHaveLength('Error: '.length + 120)
    expect(describeError('строка')).toBe('строка')
    expect(describeError(undefined)).toBe('Неизвестная ошибка')
  })
})
