import { db } from '../../db/database'
import type { Id, IsoDate, Transaction } from '../../types/entities'
import { createId } from '../../utils/id'
import { settingsRepository } from '../settings/repository'
import type { TransactionInput } from './validation'

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

  /** Сохраняет операцию и запоминает счёт как выбранный по умолчанию. */
  async create(input: TransactionInput): Promise<Transaction> {
    const now = Date.now()
    const transaction: Transaction = { ...input, id: createId(), createdAt: now, updatedAt: now }

    await db.transaction('rw', db.transactions, db.settings, async () => {
      await db.transactions.add(transaction)
      await settingsRepository.update({ lastAccountId: input.accountId })
    })

    return transaction
  },

  async update(id: Id, input: TransactionInput): Promise<void> {
    const updated = await db.transactions.update(id, { ...input, updatedAt: Date.now() })
    if (updated === 0) throw new Error('Операция не найдена')
  },

  remove(id: Id): Promise<void> {
    return db.transactions.delete(id)
  },

  countByAccount(accountId: Id): Promise<number> {
    return db.transactions.where('accountId').equals(accountId).count()
  },

  countByCategory(categoryId: Id): Promise<number> {
    return db.transactions.where('categoryId').equals(categoryId).count()
  },

  /** Сколько раз использовалась каждая категория. Читает только ключи индекса, без самих операций. */
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
