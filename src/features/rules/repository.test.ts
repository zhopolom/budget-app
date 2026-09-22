import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { accountsRepository } from '../accounts/repository'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { categoriesRepository } from '../categories/repository'
import { transactionsRepository } from '../transactions/repository'
import { categoryRulesRepository } from './repository'
import type { CategoryRuleInput } from './validation'

const { card, cash } = DEFAULT_ACCOUNT_IDS

const input = (patch: Partial<CategoryRuleInput> = {}): CategoryRuleInput => ({
  name: 'Spotify',
  enabled: true,
  matchType: 'contains',
  pattern: 'spotify',
  categoryId: C.subscriptions,
  accountId: null,
  priority: 10,
  ...patch,
})

beforeEach(resetTestDatabase)

describe('categoryRulesRepository', () => {
  it('создаёт, правит и удаляет правило; ссылки проверяются', async () => {
    const rule = await categoryRulesRepository.create(input())
    expect(await categoryRulesRepository.get(rule.id)).toMatchObject({ pattern: 'spotify', priority: 10, enabled: true })

    await categoryRulesRepository.update(rule.id, input({ pattern: 'spotify premium', accountId: card, priority: 20 }))
    expect(await categoryRulesRepository.get(rule.id)).toMatchObject({ pattern: 'spotify premium', accountId: card, priority: 20 })

    await expect(categoryRulesRepository.create(input({ categoryId: 'cat-ghost' }))).rejects.toThrow('Категория не найдена')
    await expect(categoryRulesRepository.create(input({ accountId: 'acc-ghost' }))).rejects.toThrow('Счёт не найден')
    await expect(categoryRulesRepository.create(input({ priority: 5_000 }))).rejects.toThrow(RangeError)

    await categoryRulesRepository.remove(rule.id)
    expect(await db.categoryRules.count()).toBe(0)
  })

  it('список идёт по приоритету вниз, при равном — по времени создания', async () => {
    await categoryRulesRepository.create(input({ name: 'low', priority: 1 }))
    await categoryRulesRepository.create(input({ name: 'high', priority: 50 }))
    await categoryRulesRepository.create(input({ name: 'mid-1', priority: 10 }))
    await categoryRulesRepository.create(input({ name: 'mid-2', priority: 10 }))
    expect((await categoryRulesRepository.listAll()).map((rule) => rule.name)).toEqual(['high', 'mid-1', 'mid-2', 'low'])
  })

  it('превью считает подходящие операции, но не меняет их', async () => {
    await transactionsRepository.create({ type: 'expense', amount: Money.fromMajor(199), categoryId: C.expenseOther, accountId: card, date: '2026-09-01', note: 'SPOTIFY Premium' })
    await transactionsRepository.create({ type: 'expense', amount: Money.fromMajor(199), categoryId: C.expenseOther, accountId: cash, date: '2026-09-02', note: 'spotify' })
    await transactionsRepository.create({ type: 'expense', amount: Money.fromMajor(430), categoryId: C.groceries, accountId: card, date: '2026-09-03', note: 'АТБ' })

    expect(await categoryRulesRepository.previewMatches({ matchType: 'contains', pattern: 'Spotify' })).toBe(2)
    expect(await categoryRulesRepository.previewMatches({ matchType: 'contains', pattern: 'Spotify', accountId: card })).toBe(1)
    await categoryRulesRepository.create(input())
    // Прошлые операции остаются в «Другое»: правило действует только на будущее
    expect((await db.transactions.toArray()).filter((t) => t.type === 'expense' && t.categoryId === C.expenseOther)).toHaveLength(2)
  })

  it('удаление категории с заменой перевозит правила, без замены — удаляет', async () => {
    const custom = await categoriesRepository.create({ name: 'Музыка', icon: '🎵', type: 'expense' })
    const rule = await categoryRulesRepository.create(input({ categoryId: custom.id }))
    await transactionsRepository.create({ type: 'expense', amount: 100, categoryId: custom.id, accountId: card, date: '2026-09-01', note: 'spotify' })

    await categoriesRepository.replaceAndRemove(custom.id, C.subscriptions)
    expect((await categoryRulesRepository.get(rule.id))?.categoryId).toBe(C.subscriptions)

    const other = await categoriesRepository.create({ name: 'Игры', icon: '🎮', type: 'expense' })
    const doomed = await categoryRulesRepository.create(input({ categoryId: other.id, pattern: 'steam' }))
    await categoriesRepository.remove(other.id)
    expect(await categoryRulesRepository.get(doomed.id)).toBeUndefined()
  })

  it('удаление счёта переводит ограничение правила на счёт-замену или снимает его', async () => {
    const savings = await accountsRepository.create({ name: 'Копилка', type: 'savings', initialBalance: 0 }, 'UAH')
    const bound = await categoryRulesRepository.create(input({ accountId: savings.id }))
    await accountsRepository.remove(savings.id)
    expect((await categoryRulesRepository.get(bound.id))?.accountId).toBeUndefined()

    const extra = await accountsRepository.create({ name: 'Вторая карта', type: 'card', initialBalance: 0 }, 'UAH')
    const moved = await categoryRulesRepository.create(input({ accountId: extra.id, pattern: 'uber' }))
    await transactionsRepository.create({ type: 'expense', amount: 100, categoryId: C.transport, accountId: extra.id, date: '2026-09-01', note: 'uber' })
    await accountsRepository.transferAndRemove(extra.id, card)
    expect((await categoryRulesRepository.get(moved.id))?.accountId).toBe(card)
  })
})
