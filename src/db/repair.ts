import type { Transaction as DexieTransaction } from 'dexie'
import { createDefaultCategories, SYSTEM_CATEGORY_IDS } from '../features/categories/defaults'
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
  /** Правила, у которых категория заменена на «Другое». Они остаются активными. */
  recurringCategories: number
  /** Создавался ли «Восстановленный счёт» в этом запуске. */
  createdRecoveredAccount: boolean
  /** Системные категории, которых не хватало и которые созданы заново. */
  systemCategories: number
}

type Record = Transaction | RecurringTransaction

function accountRefsOf(item: Record): Id[] {
  return item.type === 'transfer' ? [item.fromAccountId, item.toAccountId] : [item.accountId]
}

function hasBrokenAccount(item: Record, accounts: ReadonlySet<Id>): boolean {
  return accountRefsOf(item).some((id) => !accounts.has(id))
}

/** Что именно пришлось починить в записи. null — с записью всё в порядке. */
interface Repaired<T extends Record> {
  record: T
  accountFixed: boolean
  categoryFixed: boolean
}

function repairRecord<T extends Record>(
  item: T,
  accounts: ReadonlySet<Id>,
  categories: ReadonlySet<Id>,
  now: number,
): Repaired<T> | null {
  let record = item
  let accountFixed = false
  let categoryFixed = false

  if (hasBrokenAccount(item, accounts)) {
    const keep = (id: Id) => (accounts.has(id) ? id : RECOVERED_ACCOUNT_ID)
    record =
      record.type === 'transfer'
        ? { ...record, fromAccountId: keep(record.fromAccountId), toAccountId: keep(record.toAccountId), updatedAt: now }
        : { ...record, accountId: keep(record.accountId), updatedAt: now }
    accountFixed = true
  }

  // У перевода категории нет; у расхода и дохода мёртвая категория ломает
  // и списки, и лимиты, и аналитику — подставляем «Другое» того же типа
  if ((record.type === 'expense' || record.type === 'income') && !categories.has(record.categoryId)) {
    const fallback = record.type === 'expense' ? SYSTEM_CATEGORY_IDS.expenseOther : SYSTEM_CATEGORY_IDS.incomeOther
    if (categories.has(fallback)) {
      record = { ...record, categoryId: fallback, updatedAt: now }
      categoryFixed = true
    }
  }

  return accountFixed || categoryFixed ? { record, accountFixed, categoryFixed } : null
}

/**
 * Системные категории обязаны существовать всегда: на «Другое» опирается
 * ремонт битых категорий, а копия старой версии или чужой файл могли их
 * не содержать. Добавляем только недостающие, по стабильным id — дублей
 * не будет, повторный вызов ничего не сделает.
 */
async function ensureSystemCategories(tx: DexieTransaction, existing: ReadonlySet<Id>, now: number): Promise<number> {
  const missing = createDefaultCategories(now).filter((category) => !existing.has(category.id))
  if (missing.length > 0) await tx.table('categories').bulkAdd(missing)
  return missing.length
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
  const now = Date.now()

  const summary: RepairSummary = {
    transactions: 0,
    recurring: 0,
    categories: 0,
    recurringCategories: 0,
    createdRecoveredAccount: false,
    systemCategories: 0,
  }

  // Сначала категории: без «Другого» чинить битые категории было бы нечем
  summary.systemCategories = await ensureSystemCategories(tx, categoryIds, now)
  for (const id of Object.values(SYSTEM_CATEGORY_IDS)) categoryIds.add(id)

  // Счёт создаём, только если есть что на него переносить
  const needsRecoveredAccount =
    transactions.some((item) => hasBrokenAccount(item, accountIds)) ||
    rules.some((rule) => hasBrokenAccount(rule, accountIds))

  if (needsRecoveredAccount && !accountIds.has(RECOVERED_ACCOUNT_ID)) {
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
    summary.createdRecoveredAccount = true
    accountIds.add(RECOVERED_ACCOUNT_ID)
  }

  for (const item of transactions) {
    const fixed = repairRecord(item, accountIds, categoryIds, now)
    if (!fixed) continue

    await tx.table('transactions').put(fixed.record)
    if (fixed.accountFixed) summary.transactions += 1
    if (fixed.categoryFixed) summary.categories += 1
  }

  for (const rule of rules) {
    const fixed = repairRecord(rule, accountIds, categoryIds, now)
    if (!fixed) continue

    // Правило с битым счётом выключаем: куда его направить, решает пользователь.
    // Из-за одной лишь категории останавливать расписание не за что — «Другое» подходит.
    // Оба поля правятся одной записью: повторный put сбросил бы первую правку
    await tx
      .table('recurringTransactions')
      .put(fixed.accountFixed ? { ...fixed.record, isActive: false } : fixed.record)

    if (fixed.accountFixed) summary.recurring += 1
    if (fixed.categoryFixed) summary.recurringCategories += 1
  }

  return summary
}
