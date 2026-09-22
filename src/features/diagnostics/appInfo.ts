import { db, DB_VERSION } from '../../db/database'
import { migrations } from '../../db/migrations'
import { BACKUP_SCHEMA_VERSION } from '../backup/format'
import { isIosStandalone } from '../../utils/platform'

/**
 * Сведения о приложении для панели диагностики (ТЗ §78): версии, режим,
 * хранилище и число записей по таблицам. Ни сумм, ни заметок — только то,
 * что помогает понять, почему на этом устройстве что-то не так.
 */

export interface StorageInfo {
  usage: number | null
  quota: number | null
  /** true — браузер обещал не вытеснять данные; null — не поддерживается. */
  persisted: boolean | null
}

export interface AppInfo {
  appVersion: string
  dbVersion: number
  /** Что сделала последняя миграция базы. */
  lastMigration: string
  backupSchemaVersion: number
  pwaMode: 'standalone' | 'browser'
  storage: StorageInfo | null
  counts: Record<'transactions' | 'accounts' | 'categories' | 'recurring' | 'pending' | 'goals' | 'templates' | 'rules' | 'imports', number>
}

export function detectPwaMode(): AppInfo['pwaMode'] {
  if (typeof window === 'undefined') return 'browser'
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  return standalone || isIosStandalone() ? 'standalone' : 'browser'
}

export async function readStorageInfo(): Promise<StorageInfo | null> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  if (!storage) return null
  const [estimate, persisted] = await Promise.all([
    storage.estimate?.().catch(() => undefined),
    storage.persisted?.().catch(() => undefined),
  ])
  return {
    usage: estimate?.usage ?? null,
    quota: estimate?.quota ?? null,
    persisted: persisted === undefined ? null : persisted,
  }
}

export async function readAppInfo(appVersion: string): Promise<AppInfo> {
  const [transactions, accounts, categories, recurring, pending, goals, templates, rules, imports] = await db.transaction(
    'r',
    [db.transactions, db.accounts, db.categories, db.recurringTransactions, db.pendingOccurrences, db.savingsGoals, db.budgetTemplates, db.categoryRules, db.importHistory],
    () =>
      Promise.all([
        db.transactions.count(),
        db.accounts.count(),
        db.categories.count(),
        db.recurringTransactions.count(),
        db.pendingOccurrences.count(),
        db.savingsGoals.count(),
        db.budgetTemplates.count(),
        db.categoryRules.count(),
        db.importHistory.count(),
      ]),
  )

  const last = migrations[migrations.length - 1]
  return {
    appVersion,
    dbVersion: db.verno || DB_VERSION,
    lastMigration: `v${last.version}: ${last.description}`,
    backupSchemaVersion: BACKUP_SCHEMA_VERSION,
    pwaMode: detectPwaMode(),
    storage: await readStorageInfo(),
    counts: { transactions, accounts, categories, recurring, pending, goals, templates, rules, imports },
  }
}

const MB = 1024 * 1024

/** «12 МБ из 2 048 МБ · не вытесняется» */
export function describeStorage(storage: StorageInfo | null): string {
  if (!storage) return 'нет данных'
  const usage = storage.usage === null ? '?' : `${Math.max(1, Math.round(storage.usage / MB))} МБ`
  const quota = storage.quota === null ? '?' : `${Math.round(storage.quota / MB).toLocaleString('ru-RU')} МБ`
  const persisted = storage.persisted === null ? 'сохранение неизвестно' : storage.persisted ? 'не вытесняется' : 'может быть вытеснено'
  return `${usage} из ${quota} · ${persisted}`
}
