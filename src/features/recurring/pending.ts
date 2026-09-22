import { db } from '../../db/database'
import type { Id, PendingOccurrence, RecurringTransaction, Transaction } from '../../types/entities'
import { createId } from '../../utils/id'
import { isPositiveMoneyAmount } from '../../utils/money'
import type { TransactionInput } from '../transactions/model'
import { transactionFromRule } from './repository'

/**
 * Вхождения расписаний в режиме подтверждения (ТЗ §24–§25).
 *
 * Пока человек не подтвердил, операции нет: ни в остатке, ни в истории.
 * Подтверждение создаёт операцию с той же связью [recurringId+occurrenceDate],
 * что и автоматическая генерация, поэтому дубль невозможен даже при гонке.
 * Пропуск ничего не создаёт, но запись остаётся: генерация не вернёт этот день.
 */

/** Вхождение вместе с расписанием — то, что нужно карточке на главной. */
export interface PendingOccurrenceView {
  occurrence: PendingOccurrence
  rule: RecurringTransaction
}

export interface ConfirmOptions {
  /**
   * Изменённые поля этого вхождения: сумма, дата, счёт, категория, комментарий.
   * Без них операция создаётся ровно по расписанию.
   */
  override?: TransactionInput
  /**
   * «Изменить все будущие»: те же сумма, счёт, категория и комментарий
   * записываются в само расписание. Дата остаётся только у этого вхождения.
   */
  applyToRule?: boolean
}

function assertOverride(rule: RecurringTransaction, override: TransactionInput): void {
  if (!isPositiveMoneyAmount(override.amount)) throw new RangeError('Сумма операции вне допустимых пределов')
  // Тип вхождения задаёт расписание: расход не становится переводом от правки суммы
  if (override.type !== rule.type) throw new Error('Тип операции не совпадает с расписанием')
}

/** Расписание с полями подтверждённого вхождения — для «Изменить все будущие». */
function ruleWithOverride(rule: RecurringTransaction, override: TransactionInput, now: number): RecurringTransaction {
  const common = { amount: override.amount, note: override.note, updatedAt: now }
  if (rule.type === 'transfer' && override.type === 'transfer') {
    return { ...rule, ...common, fromAccountId: override.fromAccountId, toAccountId: override.toAccountId }
  }
  if (rule.type !== 'transfer' && (override.type === 'expense' || override.type === 'income')) {
    return { ...rule, ...common, type: override.type, accountId: override.accountId, categoryId: override.categoryId }
  }
  return rule
}

export const pendingOccurrencesRepository = {
  /** Ждущие решения — по дате срока, самые ранние первыми. */
  listPending(): Promise<PendingOccurrence[]> {
    return db.pendingOccurrences.where('status').equals('pending').sortBy('scheduledDate')
  },

  get(id: Id): Promise<PendingOccurrence | undefined> {
    return db.pendingOccurrences.get(id)
  },

  /** Ждущие вхождения вместе с расписаниями. Вхождения без расписания не показываем — их снимает ремонт. */
  async listPendingViews(): Promise<PendingOccurrenceView[]> {
    return db.transaction('r', db.pendingOccurrences, db.recurringTransactions, async () => {
      const [occurrences, rules] = await Promise.all([
        pendingOccurrencesRepository.listPending(),
        db.recurringTransactions.toArray(),
      ])
      const ruleById = new Map(rules.map((rule) => [rule.id, rule]))
      return occurrences.flatMap((occurrence) => {
        const rule = ruleById.get(occurrence.recurringId)
        return rule ? [{ occurrence, rule }] : []
      })
    })
  },

  /**
   * Подтверждает вхождение: создаёт операцию и помечает запись confirmed.
   * Повторное подтверждение — ошибка, а не вторая операция: статус
   * проверяется в той же транзакции, а уникальный индекс операций страхует.
   */
  async confirm(id: Id, options: ConfirmOptions = {}): Promise<Transaction> {
    return db.transaction('rw', db.pendingOccurrences, db.recurringTransactions, db.transactions, async () => {
      const occurrence = await db.pendingOccurrences.get(id)
      if (!occurrence) throw new Error('Вхождение не найдено')
      if (occurrence.status !== 'pending') {
        throw new Error(occurrence.status === 'confirmed' ? 'Операция уже подтверждена' : 'Операция уже пропущена')
      }

      const rule = await db.recurringTransactions.get(occurrence.recurringId)
      if (!rule) throw new Error('Расписание удалено — подтверждать нечего')

      const now = Date.now()
      let transaction: Transaction
      if (options.override) {
        assertOverride(rule, options.override)
        transaction = {
          ...options.override,
          id: createId(),
          recurringId: rule.id,
          // Связь с расписанием — по дате срока, даже если дату операции изменили
          occurrenceDate: occurrence.scheduledDate,
          createdAt: now,
          updatedAt: now,
        } as Transaction
        if (options.applyToRule) await db.recurringTransactions.put(ruleWithOverride(rule, options.override, now))
      } else {
        transaction = transactionFromRule(rule, occurrence.scheduledDate, now)
      }

      await db.transactions.add(transaction)
      await db.pendingOccurrences.update(id, {
        status: 'confirmed',
        transactionId: transaction.id,
        updatedAt: now,
      })
      return transaction
    })
  },

  /** Пропускает вхождение: операции не будет, а день считается разобранным. */
  async skip(id: Id): Promise<void> {
    await db.transaction('rw', db.pendingOccurrences, async () => {
      const occurrence = await db.pendingOccurrences.get(id)
      if (!occurrence) throw new Error('Вхождение не найдено')
      if (occurrence.status !== 'pending') {
        throw new Error(occurrence.status === 'confirmed' ? 'Операция уже подтверждена' : 'Операция уже пропущена')
      }
      await db.pendingOccurrences.update(id, { status: 'skipped', updatedAt: Date.now() })
    })
  },

  /** Сколько вхождений ждут решения. */
  countPending(): Promise<number> {
    return db.pendingOccurrences.where('status').equals('pending').count()
  },

  /** Для тестов и диагностики: все вхождения расписания по дате. */
  listByRule(recurringId: Id): Promise<PendingOccurrence[]> {
    return db.pendingOccurrences.where('recurringId').equals(recurringId).sortBy('scheduledDate')
  },
}
