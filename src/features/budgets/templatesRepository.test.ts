import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import { Money } from '../../utils/money'
import { categoriesRepository } from '../categories/repository'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { budgetsRepository, categoryBudgetsRepository } from './repository'
import { snapshotOfMonth, templatesRepository } from './templatesRepository'

const AUGUST = { year: 2026, month: 8 }
const SEPTEMBER = { year: 2026, month: 9 }
const OCTOBER = { year: 2026, month: 10 }

async function seedSeptember() {
  await budgetsRepository.setForMonth(SEPTEMBER, Money.fromMajor(20_000))
  await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(6_000))
  await categoryBudgetsRepository.set(SEPTEMBER, C.transport, Money.fromMajor(2_000))
}

beforeEach(resetTestDatabase)

describe('шаблоны бюджета', () => {
  it('создаётся из бюджета месяца и не меняется вместе с ним', async () => {
    await seedSeptember()
    const template = await templatesRepository.createFromMonth('Обычный месяц', SEPTEMBER)

    expect(template).toMatchObject({
      name: 'Обычный месяц',
      totalLimit: Money.fromMajor(20_000),
      categoryLimits: [
        { categoryId: C.groceries, limitAmount: Money.fromMajor(6_000) },
        { categoryId: C.transport, limitAmount: Money.fromMajor(2_000) },
      ],
    })

    // Месяц потом поменяли — шаблон остался прежним
    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(9_000))
    expect((await templatesRepository.get(template.id))?.categoryLimits[0].limitAmount).toBe(Money.fromMajor(6_000))
  })

  it('из пустого месяца шаблон не создаётся, имя обязательно', async () => {
    await expect(templatesRepository.createFromMonth('Пустой', SEPTEMBER)).rejects.toThrow('сохранять нечего')
    await seedSeptember()
    await expect(templatesRepository.createFromMonth('   ', SEPTEMBER)).rejects.toThrow('название')
  })

  it('применяется к пустому месяцу целиком', async () => {
    await seedSeptember()
    const template = await templatesRepository.createFromMonth('Обычный месяц', SEPTEMBER)

    const plan = await templatesRepository.applyToMonth(template.id, OCTOBER, 'replace')

    expect(plan.added).toHaveLength(2)
    expect((await budgetsRepository.getForMonth(OCTOBER))?.totalLimit).toBe(Money.fromMajor(20_000))
    expect(await snapshotOfMonth(OCTOBER)).toEqual(await snapshotOfMonth(SEPTEMBER))
  })

  it('merge дополняет месяц, не трогая заданное', async () => {
    await seedSeptember()
    const template = await templatesRepository.createFromMonth('Обычный месяц', SEPTEMBER)
    await categoryBudgetsRepository.set(OCTOBER, C.groceries, Money.fromMajor(7_500))
    await categoryBudgetsRepository.set(OCTOBER, C.cafe, Money.fromMajor(1_000))

    const plan = await templatesRepository.applyToMonth(template.id, OCTOBER, 'merge')

    expect(plan.added.map((limit) => limit.categoryId)).toEqual([C.transport])
    expect(plan.kept).toEqual([C.groceries])
    const october = await snapshotOfMonth(OCTOBER)
    expect(october.totalLimit).toBe(Money.fromMajor(20_000))
    // Порядок задаёт индекс: сравниваем по категориям
    expect([...october.categoryLimits].sort((a, b) => a.categoryId.localeCompare(b.categoryId))).toEqual(
      [
        { categoryId: C.groceries, limitAmount: Money.fromMajor(7_500) },
        { categoryId: C.cafe, limitAmount: Money.fromMajor(1_000) },
        { categoryId: C.transport, limitAmount: Money.fromMajor(2_000) },
      ].sort((a, b) => a.categoryId.localeCompare(b.categoryId)),
    )
  })

  it('replace делает месяц копией шаблона', async () => {
    await seedSeptember()
    const template = await templatesRepository.createFromMonth('Обычный месяц', SEPTEMBER)
    await budgetsRepository.setForMonth(OCTOBER, Money.fromMajor(15_000))
    await categoryBudgetsRepository.set(OCTOBER, C.groceries, Money.fromMajor(7_500))
    await categoryBudgetsRepository.set(OCTOBER, C.cafe, Money.fromMajor(1_000))

    const plan = await templatesRepository.applyToMonth(template.id, OCTOBER, 'replace')

    expect(plan.changed.map((limit) => limit.categoryId)).toEqual([C.groceries])
    expect(plan.removed).toEqual([C.cafe])
    expect(plan.total).toEqual({ from: Money.fromMajor(15_000), to: Money.fromMajor(20_000) })
    expect(await snapshotOfMonth(OCTOBER)).toEqual(await snapshotOfMonth(SEPTEMBER))
    // Сентябрь не тронут
    expect((await snapshotOfMonth(SEPTEMBER)).categoryLimits).toHaveLength(2)
  })

  it('удалённая категория выпадает из шаблона, а не ломает применение', async () => {
    const custom = await categoriesRepository.create({ name: 'Хобби', icon: '🎨', type: 'expense' })
    await seedSeptember()
    await categoryBudgetsRepository.set(SEPTEMBER, custom.id, Money.fromMajor(500))
    const template = await templatesRepository.createFromMonth('С хобби', SEPTEMBER)
    expect(template.categoryLimits).toHaveLength(3)

    await categoriesRepository.replaceAndRemove(custom.id, C.entertainment)

    expect((await templatesRepository.get(template.id))?.categoryLimits.map((limit) => limit.categoryId)).toEqual([
      C.groceries,
      C.transport,
    ])
    const plan = await templatesRepository.applyToMonth(template.id, OCTOBER, 'replace')
    expect(plan.skipped).toEqual([])
    expect(plan.added).toHaveLength(2)
  })

  it('удаление шаблона не трогает бюджеты месяцев', async () => {
    await seedSeptember()
    const template = await templatesRepository.createFromMonth('Обычный месяц', SEPTEMBER)
    await templatesRepository.applyToMonth(template.id, OCTOBER, 'replace')

    await templatesRepository.remove(template.id)

    expect(await db.budgetTemplates.count()).toBe(0)
    expect((await snapshotOfMonth(OCTOBER)).categoryLimits).toHaveLength(2)
  })
})

describe('копирование бюджета месяца (ТЗ §40)', () => {
  it('создаёт общий бюджет и лимиты, месяцы не связаны', async () => {
    await budgetsRepository.setForMonth(AUGUST, Money.fromMajor(18_000))
    await categoryBudgetsRepository.set(AUGUST, C.groceries, Money.fromMajor(5_000))

    const plan = await templatesRepository.copyMonth(AUGUST, SEPTEMBER, 'replace')

    expect(plan.total).toEqual({ from: 0, to: Money.fromMajor(18_000) })
    expect(await snapshotOfMonth(SEPTEMBER)).toEqual(await snapshotOfMonth(AUGUST))

    await categoryBudgetsRepository.set(SEPTEMBER, C.groceries, Money.fromMajor(9_000))
    expect((await snapshotOfMonth(AUGUST)).categoryLimits[0].limitAmount).toBe(Money.fromMajor(5_000))
  })

  it('флаг переноса остатка едет вместе с лимитом', async () => {
    await categoryBudgetsRepository.set(AUGUST, C.groceries, Money.fromMajor(5_000), { rollover: true })
    await templatesRepository.copyMonth(AUGUST, SEPTEMBER, 'replace')
    expect((await categoryBudgetsRepository.listForMonth(SEPTEMBER))[0].rollover).toBe(true)
  })

  it('из пустого месяца и в тот же месяц копировать нельзя', async () => {
    await expect(templatesRepository.copyMonth(AUGUST, SEPTEMBER, 'replace')).rejects.toThrow('копировать нечего')
    await seedSeptember()
    expect(() => templatesRepository.copyMonth(SEPTEMBER, SEPTEMBER, 'replace')).toThrow('тот же месяц')
  })
})
