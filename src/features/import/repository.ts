import { db } from '../../db/database'
import type { EntryTransaction, Id, ImportHistory, Transaction } from '../../types/entities'
import { createId } from '../../utils/id'
import { isPositiveMoneyAmount } from '../../utils/money'
import { isEntry } from '../transactions/model'
import { fingerprint } from './fingerprint'
import { isImportable, summarizeRows, type ImportRow } from './session'

/**
 * Запись импорта в базу (ТЗ §50, §53–§54): одна транзакция Dexie на всю
 * партию, история импорта, откат по importBatchId. Изменённые после импорта
 * записи откат не удаляет без явного согласия.
 */

/** Отпечаток существующей операции: сохранённый при импорте или посчитанный по полям. */
export function fingerprintOfTransaction(transaction: EntryTransaction): string {
  return (
    transaction.sourceFingerprint ??
    fingerprint({
      date: transaction.date,
      amount: transaction.amount,
      type: transaction.type,
      accountId: transaction.accountId,
      description: transaction.note,
    })
  )
}

/** Отпечатки расходов и доходов счёта — против них ищутся дубли. */
export async function loadExistingFingerprints(accountId: Id): Promise<Set<string>> {
  const transactions = await db.transactions.where('accountId').equals(accountId).toArray()
  const prints = new Set<string>()
  for (const transaction of transactions) {
    if (isEntry(transaction)) prints.add(fingerprintOfTransaction(transaction))
  }
  return prints
}

export interface CommitImportInput {
  fileName: string
  accountId: Id
  rows: readonly ImportRow[]
}

export interface RollbackPreview {
  total: number
  /** Изменены пользователем после импорта: удалять их без предупреждения нельзя. */
  modified: number
  alreadyRolledBack: boolean
}

export interface RollbackResult {
  deleted: number
  kept: number
}

export const importRepository = {
  /** Записывает включённые строки одной транзакцией. Ничего не пишется, если хоть одна ссылка битая. */
  async commit(input: CommitImportInput): Promise<ImportHistory> {
    const rows = input.rows.filter(isImportable)
    if (rows.length === 0) throw new Error('Нет строк для импорта')

    return db.transaction('rw', db.transactions, db.importHistory, db.accounts, db.categories, async () => {
      if (!(await db.accounts.get(input.accountId))) throw new Error('Счёт не найден')
      const categories = new Set((await db.categories.toArray()).map((category) => category.id))

      const now = Date.now()
      const history: ImportHistory = {
        id: createId(),
        fileName: input.fileName,
        accountId: input.accountId,
        importedAt: now,
        count: rows.length,
        skippedCount: input.rows.length - rows.length,
        duplicateCount: summarizeRows(input.rows).duplicates,
        errorCount: summarizeRows(input.rows).errors,
      }

      const transactions: Transaction[] = rows.map((row) => {
        if (!row.categoryId || !categories.has(row.categoryId)) throw new Error(`Строка ${row.line}: категория не найдена`)
        if (!row.date || !row.type || !isPositiveMoneyAmount(row.amount)) throw new Error(`Строка ${row.line}: не читается`)
        return {
          id: createId(),
          type: row.type,
          amount: row.amount,
          categoryId: row.categoryId,
          accountId: input.accountId,
          date: row.date,
          note: row.description,
          source: 'csv',
          importBatchId: history.id,
          sourceFingerprint: row.fingerprint,
          createdAt: now,
          updatedAt: now,
        }
      })

      await db.transactions.bulkAdd(transactions)
      await db.importHistory.add(history)
      return history
    })
  },

  listHistory(): Promise<ImportHistory[]> {
    return db.importHistory.orderBy('importedAt').reverse().toArray()
  },

  getHistory(id: Id): Promise<ImportHistory | undefined> {
    return db.importHistory.get(id)
  },

  /** Что затронет откат — показать до удаления. */
  async rollbackPreview(batchId: Id): Promise<RollbackPreview> {
    const [history, transactions] = await Promise.all([
      db.importHistory.get(batchId),
      db.transactions.where('importBatchId').equals(batchId).toArray(),
    ])
    return {
      total: transactions.length,
      modified: transactions.filter((transaction) => transaction.updatedAt > transaction.createdAt).length,
      alreadyRolledBack: history?.rolledBackAt !== undefined,
    }
  },

  /**
   * Удаляет операции партии. Изменённые пользователем — только с includeModified.
   * Одна транзакция: половина партии остаться не может.
   */
  async rollback(batchId: Id, options: { includeModified: boolean }): Promise<RollbackResult> {
    return db.transaction('rw', db.transactions, db.importHistory, async () => {
      const transactions = await db.transactions.where('importBatchId').equals(batchId).toArray()
      const doomed = transactions.filter((transaction) => options.includeModified || transaction.updatedAt <= transaction.createdAt)
      await db.transactions.bulkDelete(doomed.map((transaction) => transaction.id))
      await db.importHistory.update(batchId, { rolledBackAt: Date.now() })
      return { deleted: doomed.length, kept: transactions.length - doomed.length }
    })
  },
}
