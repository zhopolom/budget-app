import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import type { Id, IsoDate, RecurringTransfer } from '../../types/entities'
import { Money } from '../../utils/money'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { accountsRepository } from '../accounts/repository'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { recurringRepository } from './repository'
import type { RecurringEntryInput } from './repository'
import { draftFromRecurring, validateRecurringDraft, type RecurringDraft } from './validation'

/**
 * Регрессии на два бага v0.2 и на то, что нашёл ревью v0.3.
 * Каждый тест написан до исправления и падал.
 */

const { card, cash } = DEFAULT_ACCOUNT_IDS

const subscription = (patch: Partial<RecurringEntryInput> = {}): RecurringEntryInput => ({
  type: 'expense',
  amount: Money.fromMajor(199),
  categoryId: C.subscriptions,
  accountId: card,
  note: 'Spotify',
  frequency: 'monthly',
  interval: 1,
  startDate: '2026-01-14',
  ...patch,
})

/** Правило прямо в базу: create сдвигает первое вхождение на сегодня. */
async function seedRule(patch: Partial<RecurringEntryInput> & { nextOccurrence?: string } = {}): Promise<Id> {
  const { nextOccurrence, ...input } = patch
  const base = subscription(input)
  const id = `rule-${await db.recurringTransactions.count()}`
  await db.recurringTransactions.add({
    ...base,
    id,
    nextOccurrence: nextOccurrence ?? base.startDate,
    isActive: true,
    executionMode: 'automatic',
    createdAt: 1,
    updatedAt: 1,
  })
  return id
}

/** Черновик, каким его снимает форма в момент открытия шторки. */
async function openForm(id: Id): Promise<RecurringDraft> {
  const rule = await recurringRepository.get(id)
  if (!rule) throw new Error('Правило не найдено')
  return draftFromRecurring(rule)
}

/** Нажатие «Сохранить» с тем черновиком, который форма держит в useState. */
async function saveForm(id: Id, draft: RecurringDraft, today: IsoDate): Promise<void> {
  const result = validateRecurringDraft(draft, {
    categories: await db.categories.toArray(),
    accounts: await db.accounts.toArray(),
  })
  if (!result.ok) throw new Error(`Форма не прошла валидацию: ${JSON.stringify(result.errors)}`)
  await recurringRepository.update(id, result.value, today)
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

  it('с backfill пропущенное создаётся сразу, а не при следующем запуске', async () => {
    const id = await seedRule({ startDate: '2026-01-14' })
    await recurringRepository.generateDue('2026-01-20')

    await recurringRepository.setActive(id, false, '2026-01-20')
    // Февраль–сентябрь, январь уже создан
    const created = await recurringRepository.setActive(id, true, '2026-09-20', { backfill: true })

    expect(created).toBe(8)
    expect(await recurringRepository.countGenerated(id)).toBe(9)

    // Приложение перезапускать не надо: досоздавать уже нечего
    expect((await recurringRepository.generateDue('2026-09-20')).created).toBe(0)
  })

  it('показывает, сколько платежей пропущено за паузу', async () => {
    const id = await seedRule({ startDate: '2026-01-14' })
    await recurringRepository.generateDue('2026-01-20')
    await recurringRepository.setActive(id, false, '2026-01-20')

    expect((await recurringRepository.resumeInfo(id, '2026-09-20')).missed).toBe(8)
    expect((await recurringRepository.resumeInfo(id, '2026-01-20')).missed).toBe(0)
  })

  it('не считает пропущенными вхождения, которые уже созданы', async () => {
    const id = await seedRule({ startDate: '2026-01-14' })
    // Сегодняшний платёж уже создан — ни пропущенным, ни предстоящим он не считается
    await recurringRepository.generateDue('2026-01-14')
    await recurringRepository.setActive(id, false, '2026-01-14')

    expect(await recurringRepository.resumeInfo(id, '2026-01-14')).toEqual({
      missed: 0,
      dueToday: false,
      finished: false,
      truncated: false,
    })
  })

  it('не занижает число пропущенного из-за лимита одного прохода', async () => {
    // Ежедневное правило на паузе почти два года: больше 400 вхождений
    const id = await seedRule({ frequency: 'daily', startDate: '2025-01-01', nextOccurrence: '2025-01-01' })
    await recurringRepository.setActive(id, false, '2025-01-01')

    const { missed, dueToday } = await recurringRepository.resumeInfo(id, '2026-09-20')
    expect(missed).toBe(627)
    expect(dueToday).toBe(true)

    // Досоздание добавляет к пропущенному сегодняшний платёж — и ни одного лишнего
    expect(await recurringRepository.setActive(id, true, '2026-09-20', { backfill: true })).toBe(missed + 1)
  })
})

describe('найдено ревью: единственный владелец флага активности', () => {
  it('сохранение формы не отменяет паузу, нажатую в той же шторке', async () => {
    const id = await seedRule({ startDate: '2026-01-14' })
    // Пользователь открыл правило — форма сняла черновик с активного правила
    const draft = await openForm(id)

    await recurringRepository.setActive(id, false, '2026-09-20')
    // …и, не закрывая шторку, поправил сумму и нажал «Сохранить»
    await saveForm(id, { ...draft, amountText: '250' }, '2026-09-20')

    const rule = await db.recurringTransactions.get(id)
    expect(rule?.isActive).toBe(false)
    expect(rule?.amount).toBe(Money.fromMajor(250))
    expect((await recurringRepository.generateDue('2026-12-31')).created).toBe(0)
  })

  it('сохранение формы не отменяет только что подтверждённое досоздание', async () => {
    const id = await seedRule({ startDate: '2026-01-14' })
    await recurringRepository.generateDue('2026-01-20')
    await recurringRepository.setActive(id, false, '2026-01-20')

    const draft = await openForm(id)
    const created = await recurringRepository.setActive(id, true, '2026-09-20', { backfill: true })
    expect(created).toBe(8)

    await saveForm(id, { ...draft, amountText: '250' }, '2026-09-20')

    const rule = await db.recurringTransactions.get(id)
    expect(rule?.isActive).toBe(true)
    // Обещанные платежи никуда не делись
    expect(await recurringRepository.countGenerated(id)).toBe(9)
  })
})

describe('найдено ревью: перевод внутри одного счёта не воскресает', () => {
  /** Регулярный перевод, сведённый к одному счёту удалением второго. */
  async function seedCollapsedTransfer(): Promise<Id> {
    const id = 'rule-transfer'
    await db.recurringTransactions.add({
      id,
      type: 'transfer',
      amount: Money.fromMajor(2_000),
      fromAccountId: cash,
      toAccountId: card,
      note: 'На накопительный',
      frequency: 'monthly',
      interval: 1,
      startDate: '2026-01-05',
      nextOccurrence: '2026-01-05',
      isActive: true,
      executionMode: 'automatic',
      createdAt: 1,
      updatedAt: 1,
    } satisfies RecurringTransfer)

    await accountsRepository.transferAndRemove(cash, card)
    return id
  }

  it('кнопка «Включить» отказывается включать такое правило', async () => {
    const id = await seedCollapsedTransfer()
    expect((await db.recurringTransactions.get(id))?.isActive).toBe(false)

    await expect(recurringRepository.setActive(id, true, '2026-09-20')).rejects.toThrow('один счёт')
    expect((await db.recurringTransactions.get(id))?.isActive).toBe(false)
  })

  it('даже включённое другим путём, оно не создаёт операций', async () => {
    const id = await seedCollapsedTransfer()
    // Как если бы флаг подняли в обход setActive — например старой версией кода
    await db.recurringTransactions.update(id, { isActive: true })

    const result = await recurringRepository.generateDue('2026-09-20')

    expect(result.created).toBe(0)
    expect(await db.transactions.count()).toBe(0)
    // И правило снова выключено: создавать ему нечего
    expect((await db.recurringTransactions.get(id))?.isActive).toBe(false)
  })
})
