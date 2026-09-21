import { db } from '../../db/database'
import { SETTINGS_ID } from '../settings/defaults'
import { settingsRepository } from '../settings/repository'
import { BACKUP_APP, BACKUP_SCHEMA_VERSION, type BackupData, type BackupFile } from './format'

/** Все таблицы разом: копия должна быть согласованным снимком, а не склейкой чтений. */
export async function createBackup(exportDate: Date, appVersion: string): Promise<BackupFile> {
  const data = await db.transaction(
    'r',
    [db.accounts, db.categories, db.transactions, db.budgets, db.categoryBudgets, db.recurringTransactions, db.settings],
    async (): Promise<BackupData> => {
      const [accounts, categories, transactions, budgets, categoryBudgets, recurringTransactions, settings] =
        await Promise.all([
          db.accounts.toArray(),
          db.categories.toArray(),
          db.transactions.toArray(),
          db.budgets.toArray(),
          db.categoryBudgets.toArray(),
          db.recurringTransactions.toArray(),
          settingsRepository.get(),
        ])

      return { accounts, categories, transactions, budgets, categoryBudgets, recurringTransactions, settings }
    },
  )

  return {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportDate: exportDate.toISOString(),
    appVersion,
    data,
  }
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2)
}

/**
 * Восстановление заменяет данные целиком, а не дописывает к текущим:
 * слияние двух историй операций дало бы дубли, которые потом не развести.
 *
 * Всё в одной транзакции Dexie — оборванное восстановление не оставит
 * половину старых данных вперемешку с половиной новых.
 */
export async function restoreBackup(data: BackupData): Promise<void> {
  await db.transaction(
    'rw',
    [db.accounts, db.categories, db.transactions, db.budgets, db.categoryBudgets, db.recurringTransactions, db.settings],
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.categories.clear(),
        db.transactions.clear(),
        db.budgets.clear(),
        db.categoryBudgets.clear(),
        db.recurringTransactions.clear(),
      ])

      await Promise.all([
        db.accounts.bulkAdd(data.accounts),
        db.categories.bulkAdd(data.categories),
        db.transactions.bulkAdd(data.transactions),
        db.budgets.bulkAdd(data.budgets),
        db.categoryBudgets.bulkAdd(data.categoryBudgets),
        db.recurringTransactions.bulkAdd(data.recurringTransactions),
        db.settings.put({ ...data.settings, id: SETTINGS_ID }),
      ])
    },
  )
}

/** Полный сброс: база удаляется и создаётся заново со значениями по умолчанию. */
export async function resetAllData(): Promise<void> {
  await db.delete()
  await db.open()
}
