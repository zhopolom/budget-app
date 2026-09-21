import type {
  Account,
  AppSettings,
  Budget,
  Category,
  CategoryBudget,
  RecurringTransaction,
  Transaction,
} from '../../types/entities'

/**
 * Версия формата файла резервной копии. Совпадает с версией схемы базы:
 * читая чужой файл, мы должны знать, каких таблиц в нём ещё не было.
 */
export const BACKUP_SCHEMA_VERSION = 2

/** Метка приложения: чтобы не пытаться восстановиться из чужого JSON. */
export const BACKUP_APP = 'budget'

export interface BackupData {
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  budgets: Budget[]
  categoryBudgets: CategoryBudget[]
  recurringTransactions: RecurringTransaction[]
  settings: AppSettings
}

export interface BackupFile {
  app: typeof BACKUP_APP
  schemaVersion: number
  /** ISO-время создания копии. */
  exportDate: string
  /** Версия приложения — для разбора проблем, на восстановление не влияет. */
  appVersion: string
  data: BackupData
}

export interface BackupCounts {
  accounts: number
  categories: number
  transactions: number
  budgets: number
  categoryBudgets: number
  recurringTransactions: number
}

export function countBackup(data: BackupData): BackupCounts {
  return {
    accounts: data.accounts.length,
    categories: data.categories.length,
    transactions: data.transactions.length,
    budgets: data.budgets.length,
    categoryBudgets: data.categoryBudgets.length,
    recurringTransactions: data.recurringTransactions.length,
  }
}

/** Имя файла с датой: budget-backup-2026-09-21.json */
export function backupFileName(date: Date, extension: 'json' | 'csv'): string {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `budget-${extension === 'csv' ? 'operations' : 'backup'}-${iso}.${extension}`
}
