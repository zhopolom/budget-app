import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import type { Account, Category, Transaction } from '../../types/entities'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { categoryBudgetsRepository } from '../budgets/repository'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { recurringRepository } from '../recurring/repository'
import { transactionsRepository } from '../transactions/repository'
import { toTransactionViews } from '../transactions/views'
import { CSV_HEADER, escapeCsvField, toCsv } from './csv'
import { backupFileName, BACKUP_SCHEMA_VERSION } from './format'
import { parseBackup } from './parse'
import { createBackup, restoreBackup, serializeBackup } from './repository'

const { card, cash } = DEFAULT_ACCOUNT_IDS

const ACCOUNTS: Account[] = [
  { id: 'card', name: 'Карта', type: 'card', initialBalance: 0, currency: 'UAH', createdAt: 1, updatedAt: 1 },
  { id: 'cash', name: 'Наличные, старые', type: 'cash', initialBalance: 0, currency: 'UAH', createdAt: 2, updatedAt: 2 },
]

const CATEGORIES: Category[] = [
  { id: 'groceries', name: 'Продукты', icon: '🛒', type: 'expense', isSystem: true, createdAt: 1 },
]

beforeEach(resetTestDatabase)

async function fillDatabase(): Promise<void> {
  await transactionsRepository.create({
    type: 'expense',
    amount: Money.fromMajor(430),
    categoryId: C.groceries,
    accountId: card,
    date: '2026-09-21',
    note: 'АТБ',
  })
  await transactionsRepository.create({
    type: 'transfer',
    amount: Money.fromMajor(1_000),
    fromAccountId: card,
    toAccountId: cash,
    date: '2026-09-19',
    note: 'Банкомат',
  })
  await categoryBudgetsRepository.set({ year: 2026, month: 9 }, C.groceries, Money.fromMajor(5_000))
  await db.budgets.put({ id: '2026-09', year: 2026, month: 9, totalLimit: Money.fromMajor(15_000) })
  await recurringRepository.create(
    {
      type: 'expense',
      amount: Money.fromMajor(199),
      categoryId: C.subscriptions,
      accountId: card,
      note: 'Spotify',
      frequency: 'monthly',
      interval: 1,
      startDate: '2026-09-14',
      isActive: true,
    },
    '2026-09-21',
  )
}

describe('createBackup', () => {
  it('собирает все таблицы и помечает версию формата', async () => {
    await fillDatabase()

    const backup = await createBackup(new Date(2026, 8, 21), '0.2.0')

    expect(backup.app).toBe('budget')
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(backup.appVersion).toBe('0.2.0')
    expect(backup.data.accounts).toHaveLength(2)
    expect(backup.data.transactions).toHaveLength(2)
    expect(backup.data.budgets).toHaveLength(1)
    expect(backup.data.categoryBudgets).toHaveLength(1)
    expect(backup.data.recurringTransactions).toHaveLength(1)
    expect(backup.data.settings.id).toBe('app')
  })

  it('копия проходит собственный разбор без потерь', async () => {
    await fillDatabase()
    const backup = await createBackup(new Date(2026, 8, 21), '0.2.0')

    const parsed = parseBackup(serializeBackup(backup))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.transactions).toHaveLength(2)
    expect(parsed.data.recurringTransactions).toHaveLength(1)
    expect(parsed.danglingReferences).toBe(0)
  })
})

describe('restoreBackup', () => {
  it('заменяет данные целиком, а не дописывает к текущим', async () => {
    await fillDatabase()
    const backup = await createBackup(new Date(2026, 8, 21), '0.2.0')

    // Добавляем лишнее — после восстановления его быть не должно
    await transactionsRepository.create({
      type: 'income',
      amount: Money.fromMajor(999),
      categoryId: C.salary,
      accountId: card,
      date: '2026-09-22',
      note: 'Лишняя',
    })
    expect(await db.transactions.count()).toBe(3)

    await restoreBackup(backup.data)

    expect(await db.transactions.count()).toBe(2)
    expect(await db.transactions.filter((item) => item.note === 'Лишняя').count()).toBe(0)
    expect(await db.categoryBudgets.count()).toBe(1)
    expect(await db.recurringTransactions.count()).toBe(1)
  })

  it('связь операции с расписанием переживает круг «копия → восстановление»', async () => {
    const recurring = await recurringRepository.create(
      {
        type: 'expense',
        amount: Money.fromMajor(199),
        categoryId: C.subscriptions,
        accountId: card,
        note: 'Spotify',
        frequency: 'monthly',
        interval: 1,
        startDate: '2026-09-14',
        isActive: true,
      },
      '2026-09-14',
    )
    await recurringRepository.generateDue('2026-09-14')

    const backup = await createBackup(new Date(2026, 8, 21), '0.2.0')
    const parsed = parseBackup(serializeBackup(backup))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    await restoreBackup(parsed.data)

    // Дубля быть не должно: составной ключ восстановился вместе с операцией
    const before = await db.transactions.count()
    await recurringRepository.generateDue('2026-09-14')
    expect(await db.transactions.count()).toBe(before)
    expect((await db.transactions.toArray())[0].recurringId).toBe(recurring.id)
  })
})

describe('parseBackup', () => {
  const wrap = (data: unknown, schemaVersion = BACKUP_SCHEMA_VERSION) =>
    JSON.stringify({ app: 'budget', schemaVersion, exportDate: '2026-09-21T00:00:00.000Z', appVersion: '0.2.0', data })

  const minimal = {
    accounts: ACCOUNTS,
    categories: CATEGORIES,
    transactions: [],
    budgets: [],
    categoryBudgets: [],
    recurringTransactions: [],
    settings: { id: 'app', baseCurrency: 'UAH', theme: 'system', lastAccountId: 'card' },
  }

  it('отклоняет не-JSON и чужие файлы', () => {
    expect(parseBackup('не json')).toEqual({ ok: false, error: 'Это не JSON-файл' })
    expect(parseBackup('{"app":"other"}')).toEqual({ ok: false, error: 'Файл создан другим приложением' })
    expect(parseBackup('[]')).toEqual({ ok: false, error: 'Файл не похож на резервную копию' })
  })

  it('отклоняет копию от более новой версии', () => {
    const result = parseBackup(wrap(minimal, BACKUP_SCHEMA_VERSION + 1))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('более новой версией')
  })

  it('называет раздел с битой записью', () => {
    const broken = { ...minimal, accounts: [ACCOUNTS[0], { id: 'x', name: 'Без типа' }] }
    const result = parseBackup(wrap(broken))
    expect(result.ok === false && result.error).toBe('Запись 2 в разделе «счета» повреждена')
  })

  it('не принимает операцию с нулевой суммой или битой датой', () => {
    const zero = { ...minimal, transactions: [{ id: 't', type: 'expense', amount: 0, categoryId: 'c', accountId: 'a', date: '2026-09-21', note: '' }] }
    expect(parseBackup(wrap(zero)).ok).toBe(false)

    const badDate = { ...minimal, transactions: [{ id: 't', type: 'expense', amount: 100, categoryId: 'c', accountId: 'a', date: '2026-02-31', note: '' }] }
    expect(parseBackup(wrap(badDate)).ok).toBe(false)
  })

  it('не принимает перевод без второй стороны', () => {
    const broken = { ...minimal, transactions: [{ id: 't', type: 'transfer', amount: 100, fromAccountId: 'card', date: '2026-09-21', note: '' }] }
    expect(parseBackup(wrap(broken)).ok).toBe(false)
  })

  it('считает битые ссылки, но копию принимает', () => {
    const dangling = {
      ...minimal,
      transactions: [
        { id: 't', type: 'expense', amount: 100, categoryId: 'ghost', accountId: 'card', date: '2026-09-21', note: '' },
      ],
    }
    const result = parseBackup(wrap(dangling))
    expect(result.ok).toBe(true)
    expect(result.ok && result.danglingReferences).toBe(1)
  })

  it('пустую копию не принимает', () => {
    const empty = { ...minimal, accounts: [], transactions: [] }
    expect(parseBackup(wrap(empty)).ok).toBe(false)
  })

  it('восстанавливает недостающие поля значениями по умолчанию', () => {
    const sparse = {
      accounts: [{ id: 'a', name: 'Счёт', type: 'card', initialBalance: 0, currency: 'UAH' }],
      categories: [],
      transactions: [],
      settings: { id: 'app' },
    }
    const result = parseBackup(wrap(sparse))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.accounts[0].createdAt).toBeGreaterThan(0)
    expect(result.data.settings.baseCurrency).toBe('UAH')
    expect(result.data.recurringTransactions).toEqual([])
  })
})

describe('импорт копии v0.1', () => {
  const legacy = JSON.stringify({
    app: 'budget',
    schemaVersion: 1,
    exportDate: '2026-08-14T00:00:00.000Z',
    data: {
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      transactions: [
        {
          id: 't1',
          type: 'expense',
          amount: 43_000,
          categoryId: 'groceries',
          accountId: 'card',
          date: '2026-08-14',
          note: 'АТБ',
          createdAt: 100,
          updatedAt: 100,
        },
      ],
      budgets: [
        {
          id: '2026-08',
          year: 2026,
          month: 8,
          totalLimit: 1_500_000,
          categoryLimits: [
            { categoryId: 'groceries', limit: 500_000 },
            { categoryId: 'broken', limit: 0 },
          ],
        },
      ],
      settings: { id: 'app', baseCurrency: 'UAH', theme: 'dark', lastAccountId: 'card' },
    },
  })

  it('принимается и переносит лимиты категорий в новую таблицу', () => {
    const result = parseBackup(legacy)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.schemaVersion).toBe(1)
    expect(result.data.transactions).toHaveLength(1)
    expect(result.data.categoryBudgets).toEqual([
      expect.objectContaining({ categoryId: 'groceries', year: 2026, month: 8, limitAmount: 500_000 }),
    ])
    expect(result.data.recurringTransactions).toEqual([])
    expect(result.data.settings.theme).toBe('dark')
  })

  it('восстанавливается в базу v0.2 без потерь', async () => {
    const result = parseBackup(legacy)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await restoreBackup(result.data)

    expect(await db.transactions.count()).toBe(1)
    expect((await db.budgets.get('2026-08'))?.totalLimit).toBe(1_500_000)
    expect(await db.categoryBudgets.count()).toBe(1)
    expect((await db.settings.get('app'))?.theme).toBe('dark')
  })
})

describe('CSV', () => {
  it('экранирует запятые, кавычки и переносы строк', () => {
    expect(escapeCsvField('АТБ')).toBe('АТБ')
    expect(escapeCsvField('Кофе, зерно')).toBe('"Кофе, зерно"')
    expect(escapeCsvField('Магазин "Сільпо"')).toBe('"Магазин ""Сільпо"""')
    expect(escapeCsvField('Первая\nвторая')).toBe('"Первая\nвторая"')
  })

  it('выгружает расход, доход и перевод по колонкам ТЗ', () => {
    const transactions: Transaction[] = [
      {
        id: 'e',
        type: 'expense',
        amount: 43_050,
        categoryId: 'groceries',
        accountId: 'card',
        date: '2026-09-21',
        note: 'АТБ, вечер',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 't',
        type: 'transfer',
        amount: 100_000,
        fromAccountId: 'card',
        toAccountId: 'cash',
        date: '2026-09-19',
        note: '',
        createdAt: 2,
        updatedAt: 2,
      },
    ]

    const csv = toCsv(toTransactionViews(transactions, CATEGORIES, ACCOUNTS), 'UAH')
    const [header, expenseRow, transferRow] = csv.split('\r\n')

    expect(header).toBe(CSV_HEADER.join(','))
    expect(expenseRow).toBe('2026-09-21,Расход,-430.50,UAH,Продукты,Карта,,,"АТБ, вечер"')
    // Название счёта с запятой тоже должно быть в кавычках
    expect(transferRow).toBe('2026-09-19,Перевод,1000.00,UAH,,,Карта,"Наличные, старые",')
  })

  it('удалённые счета и категории оставляют колонку пустой', () => {
    const orphan: Transaction[] = [
      {
        id: 'e',
        type: 'expense',
        amount: 100,
        categoryId: 'ghost',
        accountId: 'ghost',
        date: '2026-09-21',
        note: '',
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    expect(toCsv(toTransactionViews(orphan, CATEGORIES, ACCOUNTS), 'UAH').split('\r\n')[1]).toBe(
      '2026-09-21,Расход,-1.00,UAH,,,,,',
    )
  })

  it('без операций отдаёт только заголовок', () => {
    expect(toCsv([], 'UAH')).toBe(CSV_HEADER.join(','))
  })
})

describe('backupFileName', () => {
  it('подставляет дату в имя файла', () => {
    expect(backupFileName(new Date(2026, 8, 21), 'json')).toBe('budget-backup-2026-09-21.json')
    expect(backupFileName(new Date(2026, 11, 1), 'csv')).toBe('budget-operations-2026-12-01.csv')
  })
})
