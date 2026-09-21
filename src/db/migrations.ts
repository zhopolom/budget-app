import type { Transaction as DexieTransaction } from 'dexie'
import { SCHEMA_V1 } from './schema'

export interface Migration {
  version: number
  description: string
  /** Таблицы, которые появились или изменили индексы. null — удалить таблицу. */
  stores: Record<string, string | null>
  /** Преобразование данных при переходе на эту версию. */
  upgrade?: (tx: DexieTransaction) => Promise<void> | void
}

/**
 * История схемы. Новые версии только добавляются в конец.
 *
 * Пример будущей миграции:
 * {
 *   version: 2,
 *   description: 'Архивирование счетов',
 *   stores: { accounts: 'id, createdAt, archivedAt' },
 *   upgrade: async (tx) => {
 *     await tx.table('accounts').toCollection().modify((account) => {
 *       account.archivedAt = null
 *     })
 *   },
 * }
 */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    description: 'Начальная схема: счета, категории, операции, бюджеты, настройки',
    stores: SCHEMA_V1,
  },
]

export const DB_VERSION = migrations[migrations.length - 1].version

if (import.meta.env.DEV) {
  migrations.forEach((migration, index) => {
    const previous = migrations[index - 1]
    if (previous && migration.version <= previous.version) {
      throw new Error(`Миграции должны идти по возрастанию версий: ${previous.version} → ${migration.version}`)
    }
  })
}
