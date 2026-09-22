import Dexie, { type Table } from 'dexie'
import type {
  Account,
  AppSettings,
  Budget,
  BudgetTemplate,
  Category,
  CategoryBudget,
  CategoryRule,
  ImportHistory,
  PendingOccurrence,
  RecurringTransaction,
  SavingsGoal,
  Transaction,
} from '../types/entities'
import { DB_VERSION, migrations } from './migrations'
import { seedDefaults } from './seed'

export const DB_NAME = 'budget'
export { DB_VERSION }

export class BudgetDatabase extends Dexie {
  declare accounts: Table<Account, string>
  declare categories: Table<Category, string>
  declare transactions: Table<Transaction, string>
  declare budgets: Table<Budget, string>
  declare categoryBudgets: Table<CategoryBudget, string>
  declare recurringTransactions: Table<RecurringTransaction, string>
  declare pendingOccurrences: Table<PendingOccurrence, string>
  declare savingsGoals: Table<SavingsGoal, string>
  declare budgetTemplates: Table<BudgetTemplate, string>
  declare importHistory: Table<ImportHistory, string>
  declare categoryRules: Table<CategoryRule, string>
  declare settings: Table<AppSettings, string>

  constructor(name: string = DB_NAME) {
    super(name)

    for (const migration of migrations) {
      const version = this.version(migration.version).stores(migration.stores)
      // Результат upgrade игнорируем: ремонт возвращает сводку, Dexie ждёт void
      if (migration.upgrade) {
        const run = migration.upgrade
        version.upgrade(async (tx) => {
          await run(tx)
        })
      }
    }

    this.on('populate', seedDefaults)
  }
}

export const db = new BudgetDatabase()
