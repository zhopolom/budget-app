import Dexie, { type Table } from 'dexie'
import type {
  Account,
  AppSettings,
  Budget,
  Category,
  CategoryBudget,
  RecurringTransaction,
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
  declare settings: Table<AppSettings, string>

  constructor(name: string = DB_NAME) {
    super(name)

    for (const migration of migrations) {
      const version = this.version(migration.version).stores(migration.stores)
      if (migration.upgrade) version.upgrade(migration.upgrade)
    }

    this.on('populate', seedDefaults)
  }
}

export const db = new BudgetDatabase()
