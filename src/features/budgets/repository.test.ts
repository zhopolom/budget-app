import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import { Money } from '../../utils/money'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { budgetsRepository, categoryBudgetsRepository } from './repository'
import { templatesRepository } from './templatesRepository'

const SEPTEMBER = { year: 2026, month: 9 }
const OCTOBER = { year: 2026, month: 10 }

beforeEach(resetTestDatabase)

describe('budgetsRepository', () => {
  it('сохраняет и перезаписывает общий бюджет месяца', async () => {
    await budgetsRepository.setForMonth(SEPTEMBER, Money.fromMajor(15_000))
    expect((await budgetsRepository.getForMonth(SEPTEMBER))?.totalLimit).toBe(Money.fromMajor(15_000))

    await budgetsRepository.setForMonth(SEPTEMBER, Money.fromMajor(18_000))
    expect(await db.budgets.count()).toBe(1)
    expect((await budgetsRepository.getForMonth(SEPTEMBER))?.totalLimit).toBe(Money.fromMajor(18_000))
  })

  it('нулевой лимит убирает бюджет', async () => {
    await budgetsRepository.setForMonth(SEPTEMBER, Money.fromMajor(15_000))
    await budgetsRepository.setForMonth(SEPTEMBER, 0)
    expect(await budgetsRepository.getForMonth(SEPTEMBER)).toBeUndefined()
  })

  it('месяцы не мешают друг другу', async () => {
    await budgetsRepository.setForMonth(SEPTEMBER, Money.fromMajor(15_000))
    await budgetsRepository.setForMonth(OCTOBER, Money.fromMajor(12_000))
    expect((await budgetsRepository.getForMonth(SEPTEMBER))?.totalLimit).toBe(Money.fromMajor(15_000))
    expect((await budgetsRepository.getForMonth(OCTOBER))?.totalLimit).toBe(Money.fromMajor(12_000))
  })
})

describe('categoryBudgetsRepository', () => {
  it('сохраняет лимит и не плодит записи при повторной записи', async () => {
    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(5_000))
    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(6_000))

    const limits = await categoryBudgetsRepository.listForMonth(SEPTEMBER)
    expect(limits).toHaveLength(1)
    expect(limits[0].limitAmount).toBe(Money.fromMajor(6_000))
  })

  it('сохраняет createdAt при изменении лимита', async () => {
    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(5_000))
    const [before] = await categoryBudgetsRepository.listForMonth(SEPTEMBER)

    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(7_000))
    const [after] = await categoryBudgetsRepository.listForMonth(SEPTEMBER)

    expect(after.createdAt).toBe(before.createdAt)
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt)
  })

  it('нулевой лимит убирает запись', async () => {
    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(5_000))
    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, 0)
    expect(await categoryBudgetsRepository.listForMonth(SEPTEMBER)).toHaveLength(0)
  })

  it('лимит привязан к месяцу', async () => {
    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(5_000))
    expect(await categoryBudgetsRepository.listForMonth(OCTOBER)).toHaveLength(0)
  })

  it('удаление категории убирает все её лимиты', async () => {
    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(5_000))
    await categoryBudgetsRepository.set(OCTOBER, C.groceries, Money.fromMajor(5_000))
    await categoryBudgetsRepository.set(SEPTEMBER, C.transport, Money.fromMajor(2_000))

    expect(await categoryBudgetsRepository.removeByCategory(C.groceries)).toBe(2)
    expect(await categoryBudgetsRepository.listAll()).toHaveLength(1)
  })

  describe('copyMonth (через templatesRepository)', () => {
    it('в режиме merge копирует только недостающие лимиты и не трогает заданные', async () => {
      await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(5_000))
      await categoryBudgetsRepository.set(SEPTEMBER, C.transport, Money.fromMajor(2_000))
      await categoryBudgetsRepository.set(OCTOBER, C.groceries, Money.fromMajor(6_000))

      const plan = await templatesRepository.copyMonth(SEPTEMBER, OCTOBER, 'merge')

      expect(plan.added.map((limit) => limit.categoryId)).toEqual([C.transport])
      expect(plan.kept).toEqual([C.groceries])
      const october = await categoryBudgetsRepository.listForMonth(OCTOBER)
      expect(october.find((item) => item.categoryId === C.groceries)?.limitAmount).toBe(Money.fromMajor(6_000))
      expect(october.find((item) => item.categoryId === C.transport)?.limitAmount).toBe(Money.fromMajor(2_000))
    })

    it('повторный вызов ничего не задваивает', async () => {
      await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(5_000))
      expect((await templatesRepository.copyMonth(SEPTEMBER, OCTOBER, 'merge')).added).toHaveLength(1)
      expect((await templatesRepository.copyMonth(SEPTEMBER, OCTOBER, 'merge')).added).toHaveLength(0)
      expect(await categoryBudgetsRepository.listForMonth(OCTOBER)).toHaveLength(1)
    })
  })
})

describe('смена валюты', () => {
  it('переводит счета в новую валюту, чтобы переводы между ними не ломались', async () => {
    const { settingsRepository } = await import('../settings/repository')

    const updated = await settingsRepository.setBaseCurrency('EUR')

    expect(updated).toBe(2)
    expect((await settingsRepository.get()).baseCurrency).toBe('EUR')
    expect((await db.accounts.toArray()).every((account) => account.currency === 'EUR')).toBe(true)
  })

  it('повторная установка той же валюты ничего не делает', async () => {
    const { settingsRepository } = await import('../settings/repository')
    expect(await settingsRepository.setBaseCurrency('UAH')).toBe(0)
  })
})
