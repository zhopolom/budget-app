import type {
  Account,
  AppSettings,
  Budget,
  Category,
  CategoryBudget,
  RecurringTransaction,
  Transaction,
} from '../../types/entities'
import { isValidIsoDate } from '../../utils/dates'
import { isNonNegativeMoneyAmount, isPositiveMoneyAmount } from '../../utils/money'
import { categoryBudgetIdFor } from '../budgets/ids'
import { MAX_RECURRING_INTERVAL } from '../recurring/occurrences'
import { createDefaultSettings } from '../settings/defaults'
import { BACKUP_APP, BACKUP_SCHEMA_VERSION, type BackupData } from './format'
import { normalizeBackup, type NormalizationSummary } from './normalize'
import { validateBackup } from './validate'

/**
 * Разбор файла резервной копии.
 *
 * Файл приходит от пользователя, поэтому проверяется строго: всё, что
 * попадёт отсюда в IndexedDB, должно быть валидной сущностью. Ошибка
 * называет конкретную таблицу — иначе «файл повреждён» ничего не объясняет.
 *
 * Битые ссылки (операция на удалённый счёт) поводом для отказа не считаются:
 * так бывает и в настоящих данных, приложение это переживает.
 */

export type ParseBackupResult =
  | {
      ok: true
      /** Уже нормализованные данные: их можно отдавать restoreBackup как есть. */
      data: BackupData
      schemaVersion: number
      danglingReferences: number
      /** Что изменила нормализация — пользователь видит это до восстановления. */
      normalization: NormalizationSummary
      /** Когда копия была снята. null — в файле не было разборчивой даты. */
      exportedAt: number | null
    }
  | {
      ok: false
      error: string
      /** Технические подробности без финансовых данных — для консоли разработчика. */
      details?: string[]
    }

type Unknown = Record<string, unknown>

const isObject = (value: unknown): value is Unknown =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isText = (value: unknown): value is string => typeof value === 'string'
const isTimestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isDate = (value: unknown): value is string => typeof value === 'string' && isValidIsoDate(value)

const CURRENCIES = new Set(['UAH', 'USD', 'EUR', 'PLN'])
const ACCOUNT_TYPES = new Set(['card', 'cash', 'savings', 'other'])
const CATEGORY_TYPES = new Set(['expense', 'income'])
const FREQUENCIES = new Set(['daily', 'weekly', 'monthly', 'yearly'])
const THEMES = new Set(['system', 'light', 'dark'])

function parseAccount(value: unknown): Account | null {
  if (!isObject(value)) return null
  const { id, name, type, initialBalance, currency, createdAt, updatedAt } = value
  if (!isId(id) || !isText(name) || typeof type !== 'string' || !ACCOUNT_TYPES.has(type)) return null
  // Отрицательный начальный остаток модель не поддерживает: форма правки взяла бы
  // модуль и при сохранении перевернула бы знак — тихо изменив баланс
  if (!isNonNegativeMoneyAmount(initialBalance)) return null
  if (typeof currency !== 'string' || !CURRENCIES.has(currency)) return null

  const stamp = isTimestamp(createdAt) ? createdAt : Date.now()
  return {
    id,
    name,
    type: type as Account['type'],
    initialBalance,
    currency: currency as Account['currency'],
    createdAt: stamp,
    updatedAt: isTimestamp(updatedAt) ? updatedAt : stamp,
  }
}

function parseCategory(value: unknown): Category | null {
  if (!isObject(value)) return null
  const { id, name, icon, type, isSystem, createdAt } = value
  if (!isId(id) || !isText(name) || !isText(icon)) return null
  if (typeof type !== 'string' || !CATEGORY_TYPES.has(type)) return null

  return {
    id,
    name,
    icon,
    type: type as Category['type'],
    isSystem: isSystem === true,
    createdAt: isTimestamp(createdAt) ? createdAt : Date.now(),
  }
}

function parseTransaction(value: unknown): Transaction | null {
  if (!isObject(value)) return null
  const { id, type, amount, date, note, createdAt, updatedAt, recurringId, occurrenceDate } = value
  if (!isId(id) || !isPositiveMoneyAmount(amount) || !isDate(date)) return null

  const stamp = isTimestamp(createdAt) ? createdAt : Date.now()
  const base = {
    id,
    amount,
    date: date as string,
    note: isText(note) ? note : '',
    createdAt: stamp,
    updatedAt: isTimestamp(updatedAt) ? updatedAt : stamp,
    // Связь с расписанием переносим: без неё восстановление создало бы дубли
    ...(isId(recurringId) && isDate(occurrenceDate)
      ? { recurringId, occurrenceDate: occurrenceDate as string }
      : {}),
  }

  if (type === 'transfer') {
    const { fromAccountId, toAccountId } = value
    if (!isId(fromAccountId) || !isId(toAccountId)) return null
    return { ...base, type: 'transfer', fromAccountId, toAccountId }
  }

  if (type === 'expense' || type === 'income') {
    const { accountId, categoryId } = value
    if (!isId(accountId) || !isId(categoryId)) return null
    return { ...base, type, accountId, categoryId }
  }

  // Корректировки появились в 0.4: счёт и направление, без категории
  if (type === 'adjustment') {
    const { accountId, direction } = value
    if (!isId(accountId) || (direction !== 'increase' && direction !== 'decrease')) return null
    return { ...base, type: 'adjustment', accountId, direction }
  }

  return null
}

function parseBudget(value: unknown): Budget | null {
  if (!isObject(value)) return null
  const { id, month, year, totalLimit } = value
  if (!isId(id) || !isMonth(month) || !isYear(year) || !isPositiveMoneyAmount(totalLimit)) return null
  return { id, month: month as number, year: year as number, totalLimit }
}

const isMonth = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12

const isYear = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1970 && value <= 9999

function parseCategoryBudget(value: unknown): CategoryBudget | null {
  if (!isObject(value)) return null
  const { id, categoryId, month, year, limitAmount, createdAt, updatedAt } = value
  if (!isId(id) || !isId(categoryId) || !isMonth(month) || !isYear(year)) return null
  if (!isPositiveMoneyAmount(limitAmount)) return null

  const stamp = isTimestamp(createdAt) ? createdAt : Date.now()
  return {
    id,
    categoryId,
    month: month as number,
    year: year as number,
    limitAmount,
    createdAt: stamp,
    updatedAt: isTimestamp(updatedAt) ? updatedAt : stamp,
  }
}

function parseRecurring(value: unknown): RecurringTransaction | null {
  if (!isObject(value)) return null
  const { id, type, amount, note, frequency, interval } = value
  const { startDate, nextOccurrence, endDate, isActive, lastGeneratedAt, createdAt, updatedAt } = value

  if (!isId(id) || !isPositiveMoneyAmount(amount)) return null
  if (typeof frequency !== 'string' || !FREQUENCIES.has(frequency)) return null
  // Та же граница, что и в форме: шаг в миллиард уронил бы арифметику дат
  if (!Number.isInteger(interval) || (interval as number) < 1 || (interval as number) > MAX_RECURRING_INTERVAL) {
    return null
  }
  if (!isDate(startDate) || !isDate(nextOccurrence)) return null

  const stamp = isTimestamp(createdAt) ? createdAt : Date.now()
  const base = {
    id,
    amount,
    note: isText(note) ? note : '',
    frequency: frequency as RecurringTransaction['frequency'],
    interval: interval as number,
    startDate: startDate as string,
    nextOccurrence: nextOccurrence as string,
    ...(isDate(endDate) ? { endDate: endDate as string } : {}),
    isActive: isActive !== false,
    ...(isTimestamp(lastGeneratedAt) ? { lastGeneratedAt } : {}),
    createdAt: stamp,
    updatedAt: isTimestamp(updatedAt) ? updatedAt : stamp,
  }

  // Регулярные переводы появились в v0.3; копии v0.2 знают только расходы и доходы
  if (type === 'transfer') {
    const { fromAccountId, toAccountId } = value
    if (!isId(fromAccountId) || !isId(toAccountId)) return null
    // Перевод внутри одного счёта приложение выключает и включить не даёт:
    // активным такое правило может быть только в отредактированном файле
    if (fromAccountId === toAccountId && base.isActive) return null
    return { ...base, type: 'transfer', fromAccountId, toAccountId }
  }

  if (type === 'expense' || type === 'income') {
    const { accountId, categoryId } = value
    if (!isId(accountId) || !isId(categoryId)) return null
    return { ...base, type, accountId, categoryId }
  }

  return null
}

function parseSettings(value: unknown): AppSettings {
  const defaults = createDefaultSettings()
  if (!isObject(value)) return defaults

  const { baseCurrency, theme, lastAccountId, lastBackupAt, backupReminderSnoozedUntil } = value
  return {
    id: 'app',
    baseCurrency:
      typeof baseCurrency === 'string' && CURRENCIES.has(baseCurrency)
        ? (baseCurrency as AppSettings['baseCurrency'])
        : defaults.baseCurrency,
    theme: typeof theme === 'string' && THEMES.has(theme) ? (theme as AppSettings['theme']) : defaults.theme,
    lastAccountId: isId(lastAccountId) ? lastAccountId : null,
    lastBackupAt: isTimestamp(lastBackupAt) ? lastBackupAt : null,
    backupReminderSnoozedUntil: isTimestamp(backupReminderSnoozedUntil) ? backupReminderSnoozedUntil : null,
  }
}

/** Разбирает массив целиком: одна битая запись — повод отказаться от файла. */
function parseList<T>(value: unknown, parse: (item: unknown) => T | null, table: string): T[] | string {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return `Раздел «${table}» повреждён`

  const result: T[] = []
  for (const [index, item] of value.entries()) {
    const parsed = parse(item)
    if (!parsed) return `Запись ${index + 1} в разделе «${table}» повреждена`
    result.push(parsed)
  }
  return result
}

/** Лимиты категорий v0.1 лежали внутри бюджета — переносим их в отдельную таблицу. */
function migrateLegacyCategoryLimits(budgets: readonly unknown[]): CategoryBudget[] {
  const now = Date.now()
  const moved: CategoryBudget[] = []

  for (const budget of budgets) {
    if (!isObject(budget) || !Array.isArray(budget.categoryLimits)) continue
    if (!isMonth(budget.month) || !isYear(budget.year)) continue

    for (const legacy of budget.categoryLimits) {
      if (!isObject(legacy) || !isId(legacy.categoryId)) continue
      if (!isPositiveMoneyAmount(legacy.limit)) continue

      const ym = { year: budget.year, month: budget.month }
      moved.push({
        id: categoryBudgetIdFor(ym, legacy.categoryId),
        categoryId: legacy.categoryId,
        year: budget.year,
        month: budget.month,
        limitAmount: legacy.limit,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  return moved
}

/**
 * Сколько записей в копии ссылается на несуществующие счета или категории.
 * Считаем и операции, и расписания: у правила ссылка на удалённый счёт
 * опаснее — оно продолжит создавать операции в никуда.
 */
function countDangling(data: BackupData): number {
  const accounts = new Set(data.accounts.map((account) => account.id))
  const categories = new Set(data.categories.map((category) => category.id))

  const isBroken = (item: BackupData['transactions'][number] | BackupData['recurringTransactions'][number]) => {
    if (item.type === 'transfer') return !accounts.has(item.fromAccountId) || !accounts.has(item.toAccountId)
    if (item.type === 'adjustment') return !accounts.has(item.accountId)
    return !accounts.has(item.accountId) || !categories.has(item.categoryId)
  }

  return data.transactions.filter(isBroken).length + data.recurringTransactions.filter(isBroken).length
}

export function parseBackup(text: string): ParseBackupResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Это не JSON-файл' }
  }

  if (!isObject(raw)) return { ok: false, error: 'Файл не похож на резервную копию' }
  if (raw.app !== BACKUP_APP) return { ok: false, error: 'Файл создан другим приложением' }

  const schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1
  if (schemaVersion > BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: 'Копия создана более новой версией Budget — обновите приложение' }
  }

  const source = isObject(raw.data) ? raw.data : raw
  const budgetsRaw = Array.isArray(source.budgets) ? source.budgets : []

  const accounts = parseList(source.accounts, parseAccount, 'счета')
  if (typeof accounts === 'string') return { ok: false, error: accounts }

  const categories = parseList(source.categories, parseCategory, 'категории')
  if (typeof categories === 'string') return { ok: false, error: categories }

  const transactions = parseList(source.transactions, parseTransaction, 'операции')
  if (typeof transactions === 'string') return { ok: false, error: transactions }

  const budgets = parseList(source.budgets, parseBudget, 'бюджеты')
  if (typeof budgets === 'string') return { ok: false, error: budgets }

  const categoryBudgets = parseList(source.categoryBudgets, parseCategoryBudget, 'лимиты категорий')
  if (typeof categoryBudgets === 'string') return { ok: false, error: categoryBudgets }

  const recurringTransactions = parseList(source.recurringTransactions, parseRecurring, 'регулярные операции')
  if (typeof recurringTransactions === 'string') return { ok: false, error: recurringTransactions }

  // Копия v1 лимитов категорий ещё не знала — достаём их из бюджетов.
  // Дубли не схлопываем: их найдёт validateBackup и откажет от файла целиком
  const legacyLimits = schemaVersion < 2 ? migrateLegacyCategoryLimits(budgetsRaw) : []

  const parsed: BackupData = {
    accounts,
    categories,
    transactions,
    budgets,
    categoryBudgets: [...categoryBudgets, ...legacyLimits],
    recurringTransactions,
    settings: parseSettings(source.settings),
  }

  if (parsed.accounts.length === 0 && parsed.transactions.length === 0) {
    return { ok: false, error: 'В копии нет ни счетов, ни операций' }
  }

  // Порядок важен: сначала уникальность и ссылки на сырых данных, потом
  // миграция в памяти, потом та же проверка ещё раз — миграция не должна
  // иметь возможности внести то, что мы только что отвергли
  const rawCheck = validateBackup(parsed)
  if (!rawCheck.ok) return { ok: false, error: rawCheck.error, details: rawCheck.details }

  const { data, summary } = normalizeBackup(parsed)

  const normalizedCheck = validateBackup(data)
  if (!normalizedCheck.ok) return { ok: false, error: normalizedCheck.error, details: normalizedCheck.details }

  const exported = typeof raw.exportDate === 'string' ? Date.parse(raw.exportDate) : Number.NaN

  return {
    ok: true,
    data,
    schemaVersion,
    danglingReferences: countDangling(data),
    normalization: summary,
    exportedAt: Number.isFinite(exported) ? exported : null,
  }
}
