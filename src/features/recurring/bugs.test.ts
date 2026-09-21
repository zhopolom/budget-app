import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import type { Id } from '../../types/entities'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { accountsRepository } from '../accounts/repository'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { recurringRepository, type RecurringInput } from './repository'

/**
 * Регрессии на два бага v0.2. Тесты написаны до исправления и падали:
 * первый оставлял в базе операцию на удалённый счёт, второй досоздавал
 * платежи за время паузы.
 */

const { card, cash } = DEFAULT_ACCOUNT_IDS

const subscription = (patch: Partial<RecurringInput> = {}): RecurringInput => ({
  type: 'expense',
  amount: Money.fromMajor(199),
  categoryId: C.subscriptions,
  accountId: card,
  note: 'Spotify',
  frequency: 'monthly',
  interval: 1,
  startDate: '2026-01-14',
  isActive: true,
  ...patch,
})

/** Правило прямо в базу: create сдвигает первое вхождение на сегодня. */
async function seedRule(patch: Partial<RecurringInput> & { nextOccurrence?: string } = {}): Promise<Id> {
  const { nextOccurrence, ...input } = patch
  const base = subscription(input)
  const id = `rule-${await db.recurringTransactions.count()}`
  await db.recurringTransactions.add({
    ...base,
    id,
    nextOccurrence: nextOccurrence ?? base.startDate,
    createdAt: 1,
    updatedAt: 1,
  })
  return id
}

/** Операции, чей счёт не существует, — то, чего в базе быть не должно никогда. */
async function danglingAccountRefs(): Promise<number> {
  const accounts = new Set((await db.accounts.toArray()).map((account) => account.id))
  const transactions = await db.transactions.toArray()
  const rules = await db.recurringTransactions.toArray()

  const brokenTransactions = transactions.filter((item) =>
    item.type === 'transfer'
      ? !accounts.has(item.fromAccountId) || !accounts.has(item.toAccountId)
      : !accounts.has(item.accountId),
  ).length

  const brokenRules = rules.filter((item) =>
    item.type === 'transfer'
      ? !accounts.has(item.fromAccountId) || !accounts.has(item.toAccountId)
      : !accounts.has(item.accountId),
  ).length

  return brokenTransactions + brokenRules
}

beforeEach(resetTestDatabase)

describe('баг 1: удаление счёта игнорировало регулярные операции', () => {
  it('не удаляет пустой счёт, на который ссылается правило', async () => {
    await seedRule({ accountId: cash, startDate: '2026-12-01' })

    await expect(accountsRepository.remove(cash)).rejects.toThrow('регулярных операциях')
    expect(await db.accounts.get(cash)).toBeDefined()
  })

  it('после удаления счёта в базе не остаётся правил на несуществующий счёт', async () => {
    const ruleId = await seedRule({ accountId: cash, startDate: '2026-12-01' })

    // Удалять придётся с переносом: панель предложит другой счёт
    await accountsRepository.transferAndRemove(cash, card)

    expect(await danglingAccountRefs()).toBe(0)
    const rule = await db.recurringTransactions.get(ruleId)
    expect(rule && 'accountId' in rule && rule.accountId).toBe(card)
  })

  it('правило на удалённый счёт больше не создаёт операций в никуда', async () => {
    await seedRule({ accountId: cash, startDate: '2026-09-01' })
    await accountsRepository.transferAndRemove(cash, card)

    await recurringRepository.generateDue('2026-09-20')

    expect(await danglingAccountRefs()).toBe(0)
  })
})

describe('баг 2: возобновление после паузы досоздавало пропущенное', () => {
  it('включение правила не создаёт платежи за время паузы', async () => {
    const id = await seedRule({ startDate: '2026-01-14' })
    await recurringRepository.generateDue('2026-01-20')
    expect(await recurringRepository.countGenerated(id)).toBe(1)

    await recurringRepository.setActive(id, false, '2026-01-20')
    // Пауза до сентября: платежей за это время не было
    await recurringRepository.setActive(id, true, '2026-09-20')

    const result = await recurringRepository.generateDue('2026-09-20')

    expect(result.created).toBe(0)
    expect(await recurringRepository.countGenerated(id)).toBe(1)
    expect((await db.recurringTransactions.get(id))?.nextOccurrence).toBe('2026-10-14')
  })

  it('с backfill пропущенное создаётся явно', async () => {
    const id = await seedRule({ startDate: '2026-01-14' })
    await recurringRepository.generateDue('2026-01-20')

    await recurringRepository.setActive(id, false, '2026-01-20')
    await recurringRepository.setActive(id, true, '2026-09-20', { backfill: true })

    const result = await recurringRepository.generateDue('2026-09-20')

    // Февраль–сентябрь, январь уже создан
    expect(result.created).toBe(8)
    expect(await recurringRepository.countGenerated(id)).toBe(9)
  })

  it('countMissed показывает, сколько платежей пропущено за паузу', async () => {
    const id = await seedRule({ startDate: '2026-01-14' })
    await recurringRepository.generateDue('2026-01-20')
    await recurringRepository.setActive(id, false, '2026-01-20')

    expect(await recurringRepository.countMissed(id, '2026-09-20')).toBe(8)
    expect(await recurringRepository.countMissed(id, '2026-01-20')).toBe(0)
  })
})
