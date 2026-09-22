import { db } from '../../db/database'
import { isPositiveMoneyAmount } from '../../utils/money'
import type { Id, IsoDate, Transaction } from '../../types/entities'
import { createId } from '../../utils/id'
import { settingsRepository } from '../settings/repository'
import type { TransactionInput } from './model'

/** Счёт, который стоит запомнить как «последний выбранный». */
function primaryAccountOf(input: TransactionInput): Id {
  return input.type === 'transfer' ? input.fromAccountId : input.accountId
}

/** Операции счёта: у расхода и дохода это accountId, у перевода — любая из сторон. */
function byAccount(accountId: Id) {
  return db.transactions
    .where('accountId')
    .equals(accountId)
    .or('fromAccountId')
    .equals(accountId)
    .or('toAccountId')
    .equals(accountId)
}

/** Последняя проверка перед записью: сумма строго положительная и в пределах политики Money. */
function assertAmount(value: unknown): void {
  if (!isPositiveMoneyAmount(value)) throw new RangeError('Сумма операции вне допустимых пределов')
}

export const transactionsRepository = {
  get(id: Id): Promise<Transaction | undefined> {
    return db.transactions.get(id)
  },

  listAll(): Promise<Transaction[]> {
    return db.transactions.toArray()
  },

  /** Операции за период, границы включительно. */
  listByDateRange(start: IsoDate, end: IsoDate): Promise<Transaction[]> {
    return db.transactions.where('date').between(start, end, true, true).toArray()
  },

  listByAccount(accountId: Id): Promise<Transaction[]> {
    return byAccount(accountId).toArray()
  },

  /** Сохраняет операцию и запоминает счёт как выбранный по умолчанию. */
  async create(input: TransactionInput): Promise<Transaction> {
    assertAmount(input.amount)
    const now = Date.now()
    const transaction = { ...input, id: createId(), createdAt: now, updatedAt: now } as Transaction

    await db.transaction('rw', db.transactions, db.settings, async () => {
      await db.transactions.add(transaction)
      await settingsRepository.update({ lastAccountId: primaryAccountOf(input) })
    })

    return transaction
  },

  /**
   * Перезаписывает операцию целиком, а не через update с частичным патчем:
   * при смене типа (расход → перевод) иначе остались бы старые categoryId
   * и accountId — операция считалась бы и переводом, и расходом сразу.
   */
  async update(id: Id, input: TransactionInput): Promise<void> {
    assertAmount(input.amount)
    await db.transaction('rw', db.transactions, async () => {
      const existing = await db.transactions.get(id)
      if (!existing) throw new Error('Операция не найдена')

      await db.transactions.put({
        ...input,
        id: existing.id,
        // Связь с регулярной операцией сохраняем: она защищает от повторной генерации
        ...(existing.recurringId ? { recurringId: existing.recurringId } : {}),
        ...(existing.occurrenceDate ? { occurrenceDate: existing.occurrenceDate } : {}),
        // Метаданные импорта — тоже: без них откат партии и поиск дублей потеряли бы запись
        ...(existing.source ? { source: existing.source } : {}),
        ...(existing.importBatchId ? { importBatchId: existing.importBatchId } : {}),
        ...(existing.sourceFingerprint ? { sourceFingerprint: existing.sourceFingerprint } : {}),
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      } as Transaction)
    })
  },

  remove(id: Id): Promise<void> {
    return db.transactions.delete(id)
  },

  countByAccount(accountId: Id): Promise<number> {
    return byAccount(accountId).count()
  },

  countByCategory(categoryId: Id): Promise<number> {
    return db.transactions.where('categoryId').equals(categoryId).count()
  },

  /**
   * Сколько раз использовалась каждая категория. Читает только ключи индекса,
   * без самих операций. Переводы в индекс categoryId не попадают.
   */
  async usageByCategory(): Promise<Map<Id, number>> {
    const keys = await db.transactions.orderBy('categoryId').keys()
    const usage = new Map<Id, number>()
    for (const key of keys) {
      const id = String(key)
      usage.set(id, (usage.get(id) ?? 0) + 1)
    }
    return usage
  },
}
