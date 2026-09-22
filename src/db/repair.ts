import type { Transaction as DexieTransaction } from 'dexie'
import { SYSTEM_CATEGORY_IDS } from '../features/categories/defaults'
import type {
  Account,
  AppSettings,
  Category,
  Id,
  RecurringTransaction,
  Transaction,
} from '../types/entities'

/**
 * Ремонт битых ссылок на счета и категории.
 *
 * До v0.3 удаление счёта не смотрело на регулярные операции, поэтому у
 * пользователя в базе могли остаться правила и созданные ими операции,
 * ссылающиеся на несуществующий счёт. Здесь мы это чиним, ничего не удаляя:
 * потерянные операции переезжают на «Восстановленный счёт», а правила
 * выключаются — куда их направить, решает пользователь.
 *
 * Вызывается и из миграции v2 → v3, и после восстановления из копии.
 * Идемпотентно: повторный запуск на почищенной базе ничего не меняет.
 */

/** Детерминированный id: повторный ремонт переиспользует тот же счёт. */
export const RECOVERED_ACCOUNT_ID = 'acc-recovered'

export interface RepairSummary {
  /** Операции, у которых переписан счёт. */
  transactions: number
  /** Правила, у которых переписан счёт (все они выключены). */
  recurring: number
  /** Операции, у которых категория заменена на «Другое». */
  categories: number
  /** Создавался ли «Восстановленный счёт» в этом запуске. */
  createdRecoveredAccount: boolean
}

const EMPTY: RepairSummary = { transactions: 0, recurring: 0, categories: 0, createdRecoveredAccount: false }

function accountRefsOf(item: Transaction | RecurringTransaction): Id[] {
  return item.type === 'transfer' ? [item.fromAccountId, item.toAccountId] : [item.accountId]
}

function hasBrokenAccount(item: Transaction | RecurringTransaction, accounts: ReadonlySet<Id>): boolean {
  return accountRefsOf(item).some((id) => !accounts.has(id))
}

export async function repairDanglingReferences(tx: DexieTransaction): Promise<RepairSummary> {
  const [accounts, categories, transactions, rules] = await Promise.all([
    tx.table('accounts').toArray() as Promise<Account[]>,
    tx.table('categories').toArray() as Promise<Category[]>,
    tx.table('transactions').toArray() as Promise<Transaction[]>,
    tx.table('recurringTransactions').toArray() as Promise<RecurringTransaction[]>,
  ])

  const accountIds = new Set(accounts.map((account) => account.id))
  const categoryIds = new Set(categories.map((category) => category.id))

  const brokenTransactions = transactions.filter((item) => hasBrokenAccount(item, accountIds))
  const brokenRules = rules.filter((rule) => hasBrokenAccount(rule, accountIds))
  const brokenCategories = transactions.filter(
    (item) => item.type !== 'transfer' && !categoryIds.has(item.categoryId),
  )

  if (brokenTransactions.length === 0 && brokenRules.length === 0 && brokenCategories.length === 0) {
    return EMPTY
  }

  const now = Date.now()
  let createdRecoveredAccount = false

  if (brokenTransactions.length > 0 || brokenRules.length > 0) {
    if (!accountIds.has(RECOVERED_ACCOUNT_ID)) {
      const settings = (await tx.table('settings').get('app')) as AppSettings | undefined
      await tx.table('accounts').put({
        id: RECOVERED_ACCOUNT_ID,
        name: 'Восстановленный счёт',
        type: 'other',
        initialBalance: 0,
        currency: settings?.baseCurrency ?? 'UAH',
        createdAt: now,
        updatedAt: now,
      } satisfies Account)
      createdRecoveredAccount = true
      accountIds.add(RECOVERED_ACCOUNT_ID)
    }

    for (const item of brokenTransactions) {
      await tx.table('transactions').put(withRepairedAccounts(item, accountIds, now))
    }

    for (const rule of brokenRules) {
      // Правило выключаем: пусть пользователь сам решит, куда его направить
      await tx.table('recurringTransactions').put({
        ...withRepairedAccounts(rule, accountIds, now),
        isActive: false,
      })
    }
  }

  // Битые категории — защита на будущее: в v0.2 они не встречались
  let repairedCategories = 0
  for (const item of brokenCategories) {
    if (item.type === 'transfer') continue
    const fallback = item.type === 'expense' ? SYSTEM_CATEGORY_IDS.expenseOther : SYSTEM_CATEGORY_IDS.incomeOther
    if (!categoryIds.has(fallback)) continue

    const repaired = brokenTransactions.includes(item)
      ? ((await tx.table('transactions').get(item.id)) as Transaction | undefined)
      : item
    if (!repaired || repaired.type === 'transfer') continue

    await tx.table('transactions').put({ ...repaired, categoryId: fallback, updatedAt: now })
    repairedCategories += 1
  }

  return {
    transactions: brokenTransactions.length,
    recurring: brokenRules.length,
    categories: repairedCategories,
    createdRecoveredAccount,
  }
}

function withRepairedAccounts<T extends Transaction | RecurringTransaction>(
  item: T,
  accounts: ReadonlySet<Id>,
  now: number,
): T {
  const keep = (id: Id) => (accounts.has(id) ? id : RECOVERED_ACCOUNT_ID)

  if (item.type === 'transfer') {
    return { ...item, fromAccountId: keep(item.fromAccountId), toAccountId: keep(item.toAccountId), updatedAt: now }
  }
  return { ...item, accountId: keep(item.accountId), updatedAt: now }
}
