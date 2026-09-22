import { db } from '../../db/database'
import type { Id, MinorUnits, SavingsGoal, Timestamp } from '../../types/entities'
import { createId } from '../../utils/id'
import { isNonNegativeMoneyAmount, isPositiveMoneyAmount } from '../../utils/money'
import type { GoalInput } from './validation'

/**
 * Цели накоплений. Правило одно: цель никогда не удаляет и не меняет счета
 * и операции (ТЗ §33). Удаление счёта, наоборот, должно разобраться с целями —
 * см. detachGoalsFromAccount.
 */

/** Последняя проверка перед записью: форма уже отсеяла мусор, но репозиторий вызывают не только формы. */
function assertGoalInput(input: GoalInput): void {
  if (!isPositiveMoneyAmount(input.targetAmount)) throw new RangeError('Сумма цели вне допустимых пределов')
  if (input.currentAmount !== null && !isNonNegativeMoneyAmount(input.currentAmount)) {
    throw new RangeError('Накопленная сумма вне допустимых пределов')
  }
  if (input.linkedAccountId !== null && input.currentAmount !== null) {
    throw new Error('У цели со счётом накопленное считается по остатку счёта')
  }
}

/** Поля из формы в запись: null снимает необязательное поле. */
function fieldsOf(input: GoalInput): Pick<SavingsGoal, 'name' | 'icon' | 'targetAmount' | 'targetDate' | 'linkedAccountId' | 'currentAmount'> {
  return {
    name: input.name,
    icon: input.icon,
    targetAmount: input.targetAmount,
    ...(input.targetDate === null ? {} : { targetDate: input.targetDate }),
    ...(input.linkedAccountId === null ? {} : { linkedAccountId: input.linkedAccountId }),
    ...(input.currentAmount === null ? {} : { currentAmount: input.currentAmount }),
  }
}

async function assertSavingsAccount(id: Id | null): Promise<void> {
  if (id === null) return
  const account = await db.accounts.get(id)
  if (!account) throw new Error('Счёт не найден')
  if (account.type !== 'savings') throw new Error('Подходит только накопительный счёт')
}

export interface DetachOptions {
  /** Перевязать цели на этот счёт. Без него цели остаются без счёта. */
  relinkTo?: Id
  /** Что записать как накопленное целям, которые остаются без счёта, — остаток удаляемого счёта. */
  keepAmount: MinorUnits
}

/**
 * Разбирается с целями удаляемого счёта (ТЗ §34): перевязывает на другой
 * накопительный счёт или оставляет без счёта, сохранив накопленное как сумму.
 * Вызывать внутри транзакции, в которой есть savingsGoals и accounts.
 */
export async function detachGoalsFromAccount(accountId: Id, options: DetachOptions, now: Timestamp): Promise<number> {
  const goals = await db.savingsGoals.where('linkedAccountId').equals(accountId).toArray()
  if (goals.length === 0) return 0

  if (options.relinkTo !== undefined) {
    const target = await db.accounts.get(options.relinkTo)
    if (!target) throw new Error('Счёт для целей не найден')
    if (target.type !== 'savings') throw new Error('Цели можно связать только с накопительным счётом')
  }

  for (const goal of goals) {
    const { linkedAccountId: _dropped, ...rest } = goal
    await db.savingsGoals.put(
      options.relinkTo !== undefined
        ? { ...goal, linkedAccountId: options.relinkTo, updatedAt: now }
        : { ...rest, currentAmount: Math.max(0, options.keepAmount), updatedAt: now },
    )
  }
  return goals.length
}

export const goalsRepository = {
  /** В порядке создания: список сам делит на активные и архив. */
  listAll(): Promise<SavingsGoal[]> {
    return db.savingsGoals.orderBy('createdAt').toArray()
  },

  get(id: Id): Promise<SavingsGoal | undefined> {
    return db.savingsGoals.get(id)
  },

  async create(input: GoalInput): Promise<SavingsGoal> {
    assertGoalInput(input)
    return db.transaction('rw', db.savingsGoals, db.accounts, async () => {
      await assertSavingsAccount(input.linkedAccountId)
      const now = Date.now()
      const goal: SavingsGoal = { ...fieldsOf(input), id: createId(), isArchived: false, createdAt: now, updatedAt: now }
      await db.savingsGoals.add(goal)
      return goal
    })
  },

  /** Перезаписывает поля целиком: снятый срок или счёт не должны остаться от старой версии. */
  async update(id: Id, input: GoalInput): Promise<void> {
    assertGoalInput(input)
    await db.transaction('rw', db.savingsGoals, db.accounts, async () => {
      const existing = await db.savingsGoals.get(id)
      if (!existing) throw new Error('Цель не найдена')
      await assertSavingsAccount(input.linkedAccountId)
      await db.savingsGoals.put({
        ...fieldsOf(input),
        id,
        isArchived: existing.isArchived,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      })
    })
  },

  async setArchived(id: Id, isArchived: boolean): Promise<void> {
    const updated = await db.savingsGoals.update(id, { isArchived, updatedAt: Date.now() })
    if (updated === 0) throw new Error('Цель не найдена')
  },

  /** Удаляет только цель: счёт и операции остаются (ТЗ §33). */
  remove(id: Id): Promise<void> {
    return db.savingsGoals.delete(id)
  },

  /** Сколько целей связано со счётом — для панели удаления счёта. */
  countLinked(accountId: Id): Promise<number> {
    return db.savingsGoals.where('linkedAccountId').equals(accountId).count()
  },
}
