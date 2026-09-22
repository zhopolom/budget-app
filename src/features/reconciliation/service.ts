import { db } from '../../db/database'
import type { AdjustmentDirection, AdjustmentTransaction, Id, IsoDate, MinorUnits } from '../../types/entities'
import { createId } from '../../utils/id'
import { isMoneyAmount, Money } from '../../utils/money'
import { calculateAccountBalances } from '../transactions/calculations'

/**
 * Сверка счёта с фактическим остатком.
 *
 * Учёт расходится с банком: забытая покупка, комиссия, кэшбэк. Вместо того
 * чтобы искать пропажу, человек вводит остаток из банка, а разница
 * записывается корректировкой — операцией, которая меняет счёт, но не
 * притворяется ни расходом, ни доходом.
 */

export interface ReconciliationPlan {
  /** Остаток по учёту Budget. */
  current: MinorUnits
  /** Остаток, который назвал пользователь. */
  actual: MinorUnits
  /** actual − current: отрицательная — в банке меньше, чем в учёте. */
  difference: MinorUnits
  /** null — остатки совпали, корректировка не нужна. */
  direction: AdjustmentDirection | null
  /** Модуль разницы: сумма будущей корректировки. */
  amount: MinorUnits
}

/** Чистый расчёт для превью: что именно будет создано. */
export function planReconciliation(current: MinorUnits, actual: MinorUnits): ReconciliationPlan {
  const difference = Money.subtract(actual, current)
  return {
    current,
    actual,
    difference,
    direction: difference === 0 ? null : difference > 0 ? 'increase' : 'decrease',
    amount: Math.abs(difference),
  }
}

export interface ReconcileInput {
  accountId: Id
  actual: MinorUnits
  /**
   * Разница, которую видел пользователь в превью. Остаток пересчитывается
   * внутри транзакции, и если он успел измениться — корректировка не
   * создаётся: человек подтверждал другую сумму.
   */
  expectedDifference: MinorUnits
  date: IsoDate
  note: string
}

/**
 * Создаёт корректировку. Возвращает null, если остатки уже совпадают.
 * Расчёт и запись — в одной транзакции: между превью и нажатием могла
 * прийти регулярная операция.
 */
export async function reconcileAccount(input: ReconcileInput): Promise<AdjustmentTransaction | null> {
  if (!isMoneyAmount(input.actual)) throw new RangeError('Фактический остаток вне допустимых пределов')

  return db.transaction('rw', db.accounts, db.transactions, async () => {
    const accounts = await db.accounts.toArray()
    if (!accounts.some((account) => account.id === input.accountId)) throw new Error('Счёт не найден')

    const current = calculateAccountBalances(accounts, await db.transactions.toArray()).get(input.accountId) ?? 0
    const plan = planReconciliation(current, input.actual)

    if (plan.difference !== input.expectedDifference) {
      throw new Error('Остаток счёта изменился — сверьте ещё раз')
    }
    if (plan.direction === null) return null

    const now = Date.now()
    const adjustment: AdjustmentTransaction = {
      id: createId(),
      type: 'adjustment',
      accountId: input.accountId,
      amount: plan.amount,
      direction: plan.direction,
      date: input.date,
      note: input.note.trim(),
      createdAt: now,
      updatedAt: now,
    }
    await db.transactions.add(adjustment)
    return adjustment
  })
}
