import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { RECOVERED_ACCOUNT_ID } from '../../db/repair'
import { resetTestDatabase } from '../../test/db'
import { MAX_AMOUNT, Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { transactionsRepository } from '../transactions/repository'
import { BACKUP_SCHEMA_VERSION } from './format'
import { parseBackup } from './parse'
import { restoreBackup } from './repository'

/**
 * Целостность данных при восстановлении из копии (0.3.2).
 *
 * Правило одно: ни одна испорченная копия не может тихо исказить баланс,
 * а неудачное восстановление не трогает текущую базу. Каждый тест здесь —
 * regression на конкретный способ это нарушить.
 */

const { card, cash } = DEFAULT_ACCOUNT_IDS

const ACCOUNTS = [
  { id: 'card', name: 'Карта', type: 'card', initialBalance: 100_000, currency: 'UAH', createdAt: 1, updatedAt: 1 },
  { id: 'cash', name: 'Наличные', type: 'cash', initialBalance: 0, currency: 'UAH', createdAt: 2, updatedAt: 2 },
]

const CATEGORIES = [
  { id: 'cat-exp-groceries', name: 'Продукты', icon: '🛒', type: 'expense', isSystem: true, createdAt: 1 },
  { id: 'cat-exp-other', name: 'Другое', icon: '📦', type: 'expense', isSystem: true, createdAt: 2 },
  { id: 'cat-inc-salary', name: 'Зарплата', icon: '💰', type: 'income', isSystem: true, createdAt: 3 },
  { id: 'cat-inc-other', name: 'Другое', icon: '✨', type: 'income', isSystem: true, createdAt: 4 },
]

const EXPENSE = {
  id: 't-1',
  type: 'expense',
  amount: 43_000,
  categoryId: 'cat-exp-groceries',
  accountId: 'card',
  date: '2026-09-14',
  note: 'АТБ',
  createdAt: 10,
  updatedAt: 10,
}

const RULE = {
  id: 'r-1',
  type: 'expense',
  amount: 19_900,
  categoryId: 'cat-exp-groceries',
  accountId: 'card',
  note: 'Spotify',
  frequency: 'monthly',
  interval: 1,
  startDate: '2026-09-14',
  nextOccurrence: '2026-10-14',
  isActive: true,
  createdAt: 11,
  updatedAt: 11,
}

const SETTINGS = { id: 'app', baseCurrency: 'UAH', theme: 'system', lastAccountId: 'card' }

type Raw = Record<string, unknown>

/** Валидная копия v3, в которой можно испортить любой раздел. */
function backup(overrides: Raw = {}, schemaVersion = BACKUP_SCHEMA_VERSION): string {
  return JSON.stringify({
    app: 'budget',
    schemaVersion,
    exportDate: '2026-09-21T00:00:00.000Z',
    appVersion: '0.3.2',
    data: {
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      transactions: [EXPENSE],
      budgets: [],
      categoryBudgets: [],
      recurringTransactions: [RULE],
      settings: SETTINGS,
      ...overrides,
    },
  })
}

/** Снимок всей базы — чтобы доказать, что отклонённая копия её не тронула. */
async function snapshot() {
  return {
    accounts: await db.accounts.toArray(),
    categories: await db.categories.toArray(),
    transactions: await db.transactions.toArray(),
    budgets: await db.budgets.toArray(),
    categoryBudgets: await db.categoryBudgets.toArray(),
    recurring: await db.recurringTransactions.toArray(),
    settings: await db.settings.toArray(),
  }
}

async function seedCurrentData(): Promise<void> {
  await transactionsRepository.create({
    type: 'income',
    amount: Money.fromMajor(1_000),
    categoryId: C.salary,
    accountId: card,
    date: '2026-09-20',
    note: 'До восстановления',
  })
}

function rejected(text: string): string {
  const result = parseBackup(text)
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.error
}

beforeEach(resetTestDatabase)

describe('деньги в копии', () => {
  it('отрицательный начальный остаток отклоняется, база не меняется', async () => {
    await seedCurrentData()
    const before = await snapshot()

    const error = rejected(backup({ accounts: [{ ...ACCOUNTS[0], initialBalance: -100_000 }, ACCOUNTS[1]] }))

    expect(error).toContain('счета')
    expect(await snapshot()).toEqual(before)
  })

  it.each([
    ['сумма операции', { transactions: [{ ...EXPENSE, amount: MAX_AMOUNT + 1 }] }, 'операции'],
    ['начальный остаток', { accounts: [{ ...ACCOUNTS[0], initialBalance: MAX_AMOUNT + 1 }, ACCOUNTS[1]] }, 'счета'],
    [
      'общий бюджет',
      { budgets: [{ id: '2026-09', year: 2026, month: 9, totalLimit: MAX_AMOUNT + 1 }] },
      'бюджеты',
    ],
    [
      'лимит категории',
      {
        categoryBudgets: [
          { id: '2026-09:cat-exp-groceries', categoryId: 'cat-exp-groceries', year: 2026, month: 9, limitAmount: MAX_AMOUNT + 1 },
        ],
      },
      'лимиты категорий',
    ],
    ['сумма регулярной операции', { recurringTransactions: [{ ...RULE, amount: MAX_AMOUNT + 1 }] }, 'регулярные операции'],
  ])('%s больше MAX_AMOUNT делает копию невалидной', (_name, overrides, section) => {
    expect(rejected(backup(overrides))).toContain(section)
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['дробь', 1.5],
    ['ноль', 0],
    ['строка', '43000'],
  ])('сумма операции «%s» отклоняется', (_name, amount) => {
    // JSON не умеет NaN и Infinity — они превратятся в null, и это тоже должно отклоняться
    expect(rejected(backup({ transactions: [{ ...EXPENSE, amount }] }))).toContain('операции')
  })

  it('нулевой и отрицательный общий бюджет отклоняются', () => {
    expect(rejected(backup({ budgets: [{ id: '2026-09', year: 2026, month: 9, totalLimit: 0 }] }))).toContain('бюджеты')
    expect(rejected(backup({ budgets: [{ id: '2026-09', year: 2026, month: 9, totalLimit: -1 }] }))).toContain('бюджеты')
  })
})

describe('одна валюта', () => {
  it('счета в чужой валюте приводятся к основной без пересчёта сумм', async () => {
    const mixed = backup({
      accounts: [ACCOUNTS[0], { ...ACCOUNTS[1], currency: 'USD', initialBalance: 5_000 }],
    })

    const parsed = parseBackup(mixed)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.normalization.currencies).toBe(1)

    await restoreBackup(parsed.data)

    const accounts = await db.accounts.toArray()
    expect(accounts.every((account) => account.currency === 'UAH')).toBe(true)
    // Число не тронуто: курсов у приложения нет
    expect(accounts.find((account) => account.id === 'cash')?.initialBalance).toBe(5_000)
  })

  it('копия в одной валюте ничего не нормализует', () => {
    const parsed = parseBackup(backup())
    expect(parsed.ok && parsed.normalization).toEqual({ currencies: 0, lastAccountReset: false })
  })
})

describe('дубли обнаруживаются до транзакции', () => {
  const DUPLICATE = 'Резервная копия содержит повторяющиеся записи.'

  it.each([
    ['счёта', { accounts: [ACCOUNTS[0], { ...ACCOUNTS[0], name: 'Копия карты' }] }],
    ['операции', { transactions: [EXPENSE, { ...EXPENSE, amount: 1 }] }],
    [
      'бюджета за месяц',
      {
        budgets: [
          { id: 'b-1', year: 2026, month: 9, totalLimit: 1_000 },
          { id: 'b-2', year: 2026, month: 9, totalLimit: 2_000 },
        ],
      },
    ],
    [
      'лимита категории за месяц',
      {
        categoryBudgets: [
          { id: 'l-1', categoryId: 'cat-exp-groceries', year: 2026, month: 9, limitAmount: 1_000 },
          { id: 'l-2', categoryId: 'cat-exp-groceries', year: 2026, month: 9, limitAmount: 2_000 },
        ],
      },
    ],
    [
      'вхождения регулярной операции',
      {
        transactions: [
          { ...EXPENSE, id: 't-1', recurringId: 'r-1', occurrenceDate: '2026-09-14' },
          { ...EXPENSE, id: 't-2', recurringId: 'r-1', occurrenceDate: '2026-09-14' },
        ],
      },
    ],
    ['регулярной операции', { recurringTransactions: [RULE, { ...RULE, note: 'Ещё раз' }] }],
  ])('дубль %s: копия отклоняется человеческой ошибкой, база не тронута', async (_name, overrides) => {
    await seedCurrentData()
    const before = await snapshot()

    const result = parseBackup(backup(overrides))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe(DUPLICATE)
    // Технические подробности есть, но без сумм и заметок
    expect(result.details?.length).toBeGreaterThan(0)
    expect(JSON.stringify(result.details)).not.toContain('АТБ')

    expect(await snapshot()).toEqual(before)
  })

  it('дубли лимитов не схлопываются молча даже в копии v1', () => {
    const legacy = JSON.stringify({
      app: 'budget',
      schemaVersion: 1,
      data: {
        accounts: ACCOUNTS,
        categories: CATEGORIES,
        transactions: [EXPENSE],
        budgets: [
          {
            id: '2026-09',
            year: 2026,
            month: 9,
            totalLimit: 10_000,
            categoryLimits: [
              { categoryId: 'cat-exp-groceries', limit: 1_000 },
              { categoryId: 'cat-exp-groceries', limit: 2_000 },
            ],
          },
        ],
        settings: SETTINGS,
      },
    })
    expect(rejected(legacy)).toBe(DUPLICATE)
  })
})

describe('ссылки', () => {
  it('операция на несуществующий счёт переезжает на «Восстановленный счёт», а не теряется', async () => {
    const parsed = parseBackup(backup({ transactions: [{ ...EXPENSE, accountId: 'ghost' }] }))
    expect(parsed.ok && parsed.danglingReferences).toBe(1)
    if (!parsed.ok) return

    await restoreBackup(parsed.data)

    const restored = await db.transactions.get('t-1')
    expect(restored && 'accountId' in restored && restored.accountId).toBe(RECOVERED_ACCOUNT_ID)
    expect(await db.transactions.count()).toBe(1)
  })

  it('операция с несуществующей категорией получает «Другое»', async () => {
    const parsed = parseBackup(backup({ transactions: [{ ...EXPENSE, categoryId: 'ghost' }] }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    await restoreBackup(parsed.data)

    const restored = await db.transactions.get('t-1')
    expect(restored && 'categoryId' in restored && restored.categoryId).toBe('cat-exp-other')
  })

  it('перевод с несуществующей стороной чинится, вторая сторона остаётся', async () => {
    const transfer = {
      id: 't-2',
      type: 'transfer',
      amount: 10_000,
      fromAccountId: 'ghost',
      toAccountId: 'cash',
      date: '2026-09-14',
      note: '',
      createdAt: 1,
      updatedAt: 1,
    }
    const parsed = parseBackup(backup({ transactions: [transfer] }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    await restoreBackup(parsed.data)

    const restored = await db.transactions.get('t-2')
    expect(restored?.type === 'transfer' && restored.fromAccountId).toBe(RECOVERED_ACCOUNT_ID)
    expect(restored?.type === 'transfer' && restored.toAccountId).toBe('cash')
  })

  it('перевод внутри одного счёта в истории принимается: приложение само создаёт такие при объединении счетов', () => {
    const self = { ...EXPENSE, id: 't-3', type: 'transfer', fromAccountId: 'card', toAccountId: 'card' }
    delete (self as Raw).categoryId
    delete (self as Raw).accountId
    expect(parseBackup(backup({ transactions: [self] })).ok).toBe(true)
  })

  it('активный регулярный перевод внутри одного счёта отклоняется, выключенный — принимается', () => {
    const selfRule = { ...RULE, id: 'r-2', type: 'transfer', fromAccountId: 'card', toAccountId: 'card' }
    delete (selfRule as Raw).categoryId
    delete (selfRule as Raw).accountId

    expect(rejected(backup({ recurringTransactions: [selfRule] }))).toContain('регулярные операции')
    expect(parseBackup(backup({ recurringTransactions: [{ ...selfRule, isActive: false }] })).ok).toBe(true)
  })

  it('лимит на несуществующую категорию — повод отказаться от файла', () => {
    const result = parseBackup(
      backup({ categoryBudgets: [{ id: 'l-1', categoryId: 'ghost', year: 2026, month: 9, limitAmount: 1_000 }] }),
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('ссылается')
  })

  it('lastAccountId, указывающий в никуда, сбрасывается и об этом сообщается', async () => {
    const parsed = parseBackup(backup({ settings: { ...SETTINGS, lastAccountId: 'ghost' } }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.normalization.lastAccountReset).toBe(true)
    expect(parsed.data.settings.lastAccountId).toBe(null)

    await restoreBackup(parsed.data)
    expect((await db.settings.get('app'))?.lastAccountId).toBe(null)
  })
})

describe('регулярные операции', () => {
  it.each([0, -1, 100, 999_999_999_999, 1.5])('шаг повтора %s отклоняется', (interval) => {
    expect(rejected(backup({ recurringTransactions: [{ ...RULE, interval }] }))).toContain('регулярные операции')
  })

  it('шаги 1 и 99 принимаются', () => {
    expect(parseBackup(backup({ recurringTransactions: [{ ...RULE, interval: 1 }] })).ok).toBe(true)
    expect(parseBackup(backup({ recurringTransactions: [{ ...RULE, interval: 99 }] })).ok).toBe(true)
  })
})

describe('атомарность восстановления', () => {
  it('сбой посреди записи откатывает всё: старые данные на месте, новых нет', async () => {
    await seedCurrentData()
    const before = await snapshot()

    const parsed = parseBackup(backup())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const boom = () => {
      throw new Error('Сбой при записи')
    }
    db.recurringTransactions.hook('creating', boom)
    try {
      await expect(restoreBackup(parsed.data)).rejects.toThrow()
    } finally {
      db.recurringTransactions.hook('creating').unsubscribe(boom)
    }

    expect(await snapshot()).toEqual(before)
  })

  it('данные с дублями не доходят до транзакции даже в обход разбора', async () => {
    await seedCurrentData()
    const before = await snapshot()

    const parsed = parseBackup(backup())
    if (!parsed.ok) throw new Error(parsed.error)
    const tampered = { ...parsed.data, transactions: [...parsed.data.transactions, ...parsed.data.transactions] }

    await expect(restoreBackup(tampered)).rejects.toThrow('повторяющиеся')
    expect(await snapshot()).toEqual(before)
  })
})

describe('совместимость и повторяемость', () => {
  it('копия v1 восстанавливается и получает недостающие системные категории', async () => {
    const legacy = JSON.stringify({
      app: 'budget',
      schemaVersion: 1,
      data: {
        accounts: ACCOUNTS,
        categories: [CATEGORIES[0]],
        transactions: [EXPENSE],
        budgets: [{ id: '2026-09', year: 2026, month: 9, totalLimit: 10_000, categoryLimits: [{ categoryId: 'cat-exp-groceries', limit: 1_000 }] }],
        settings: { id: 'app', baseCurrency: 'UAH', theme: 'dark', lastAccountId: 'card' },
      },
    })
    const parsed = parseBackup(legacy)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const repaired = await restoreBackup(parsed.data)

    expect(await db.transactions.count()).toBe(1)
    expect(await db.categoryBudgets.count()).toBe(1)
    // «Другое» и остальные системные категории появились, продукты остались одни
    expect(repaired.systemCategories).toBe(Object.keys(C).length - 1)
    expect(await db.categories.where('id').equals('cat-exp-other').count()).toBe(1)
    expect(await db.categories.where('id').equals('cat-exp-groceries').count()).toBe(1)
  })

  it('копия v2 восстанавливается как есть', async () => {
    const parsed = parseBackup(backup({}, 2))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    await restoreBackup(parsed.data)
    expect(await db.transactions.count()).toBe(1)
    expect(await db.recurringTransactions.count()).toBe(1)
  })

  it('повторное восстановление той же копии даёт ту же базу', async () => {
    const parsed = parseBackup(backup({ transactions: [{ ...EXPENSE, accountId: 'ghost' }] }))
    if (!parsed.ok) throw new Error(parsed.error)

    await restoreBackup(parsed.data)
    const first = await snapshot()
    await restoreBackup(parsed.data)
    const second = await snapshot()

    const withoutStamps = (state: Awaited<ReturnType<typeof snapshot>>) =>
      JSON.parse(JSON.stringify(state).replace(/"(createdAt|updatedAt)":\d+/g, '"$1":0'))
    expect(withoutStamps(second)).toEqual(withoutStamps(first))
  })

  it('восстановленный «Восстановленный счёт» не плодится при повторе', async () => {
    const parsed = parseBackup(backup({ transactions: [{ ...EXPENSE, accountId: 'ghost' }] }))
    if (!parsed.ok) throw new Error(parsed.error)

    await restoreBackup(parsed.data)
    await restoreBackup(parsed.data)

    expect(await db.accounts.where('id').equals(RECOVERED_ACCOUNT_ID).count()).toBe(1)
    expect(await db.accounts.count()).toBe(3)
    expect((await db.accounts.toArray()).some((account) => account.id === cash)).toBe(false)
  })
})
