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
} from '../../types/entities'
import { isValidIsoDate } from '../../utils/dates'
import { isNonNegativeMoneyAmount, isPositiveMoneyAmount } from '../../utils/money'
import { MAX_RECURRING_INTERVAL } from '../recurring/occurrences'
import { createDefaultSettings } from '../settings/defaults'
import { BACKUP_APP, BACKUP_SCHEMA_VERSION, type BackupData } from './format'
import { migrateBackupData } from './migrations'
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
 *
 * Старые версии формата сначала проходят цепочку миграций (migrations.ts),
 * и разбор всегда видит данные актуальной версии. Значения по умолчанию
 * здесь остаются второй линией: они прикрывают файл, отредактированный руками.
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
      /** Через какие версии формата копия прошла перед разбором. Пусто — файл актуальный. */
      migrationSteps: number[]
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
const EXECUTION_MODES = new Set(['automatic', 'confirm'])
const OCCURRENCE_STATUSES = new Set(['pending', 'confirmed', 'skipped'])
const TRANSACTION_SOURCES = new Set(['manual', 'recurring', 'csv', 'adjustment'])
const RULE_MATCH_TYPES = new Set(['contains', 'startsWith', 'exact'])
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
  const { source, importBatchId, sourceFingerprint } = value
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
    // Метаданные импорта (v6): без них откат партии и поиск дублей потеряли бы запись
    ...(typeof source === 'string' && TRANSACTION_SOURCES.has(source) ? { source: source as Transaction['source'] } : {}),
    ...(isId(importBatchId) ? { importBatchId } : {}),
    ...(isId(sourceFingerprint) ? { sourceFingerprint } : {}),
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
  const { id, categoryId, month, year, limitAmount, rollover, createdAt, updatedAt } = value
  if (!isId(id) || !isId(categoryId) || !isMonth(month) || !isYear(year)) return null
  if (!isPositiveMoneyAmount(limitAmount)) return null

  const stamp = isTimestamp(createdAt) ? createdAt : Date.now()
  return {
    id,
    categoryId,
    month: month as number,
    year: year as number,
    limitAmount,
    // Перенос остатка (0.5): храним только включённым
    ...(rollover === true ? { rollover: true } : {}),
    createdAt: stamp,
    updatedAt: isTimestamp(updatedAt) ? updatedAt : stamp,
  }
}

/** Цель накоплений (v5). Ссылка на счёт проверяется не здесь: её чинит ремонт, как у операций. */
function parseSavingsGoal(value: unknown): SavingsGoal | null {
  if (!isObject(value)) return null
  const { id, name, icon, targetAmount, currentAmount, targetDate, linkedAccountId, isArchived, createdAt, updatedAt } = value
  if (!isId(id) || !isText(name) || !isPositiveMoneyAmount(targetAmount)) return null
  if (currentAmount !== undefined && currentAmount !== null && !isNonNegativeMoneyAmount(currentAmount)) return null
  if (targetDate !== undefined && targetDate !== null && !isDate(targetDate)) return null

  const stamp = isTimestamp(createdAt) ? createdAt : Date.now()
  return {
    id,
    name,
    icon: isText(icon) && icon !== '' ? icon : '🎯',
    targetAmount,
    // У цели со счётом накопленное считается по остатку — ручную сумму не переносим
    ...(isId(linkedAccountId) ? { linkedAccountId } : isNonNegativeMoneyAmount(currentAmount) ? { currentAmount } : {}),
    ...(isDate(targetDate) ? { targetDate: targetDate as string } : {}),
    isArchived: isArchived === true,
    createdAt: stamp,
    updatedAt: isTimestamp(updatedAt) ? updatedAt : stamp,
  }
}

/** Шаблон бюджета (v5). Лимиты на неизвестные категории снимает ремонт после восстановления. */
function parseBudgetTemplate(value: unknown): BudgetTemplate | null {
  if (!isObject(value)) return null
  const { id, name, totalLimit, categoryLimits, createdAt, updatedAt } = value
  if (!isId(id) || !isText(name) || !isNonNegativeMoneyAmount(totalLimit)) return null
  if (categoryLimits !== undefined && !Array.isArray(categoryLimits)) return null

  const limits: BudgetTemplate['categoryLimits'] = []
  for (const limit of categoryLimits ?? []) {
    if (!isObject(limit) || !isId(limit.categoryId) || !isPositiveMoneyAmount(limit.limitAmount)) return null
    limits.push({ categoryId: limit.categoryId, limitAmount: limit.limitAmount })
  }

  const stamp = isTimestamp(createdAt) ? createdAt : Date.now()
  return {
    id,
    name,
    totalLimit,
    categoryLimits: limits,
    createdAt: stamp,
    updatedAt: isTimestamp(updatedAt) ? updatedAt : stamp,
  }
}

function parseRecurring(value: unknown): RecurringTransaction | null {
  if (!isObject(value)) return null
  const { id, type, amount, note, frequency, interval, executionMode } = value
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
    // Копии до v4 режима не знали: их правила срабатывали автоматически
    executionMode:
      typeof executionMode === 'string' && EXECUTION_MODES.has(executionMode)
        ? (executionMode as RecurringTransaction['executionMode'])
        : 'automatic',
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

/** Ожидающие вхождения появились в v4; ссылка на расписание проверяется в validateBackup. */
function parsePendingOccurrence(value: unknown): PendingOccurrence | null {
  if (!isObject(value)) return null
  const { id, recurringId, scheduledDate, status, transactionId, createdAt, updatedAt } = value
  if (!isId(id) || !isId(recurringId) || !isDate(scheduledDate)) return null
  if (typeof status !== 'string' || !OCCURRENCE_STATUSES.has(status)) return null

  const stamp = isTimestamp(createdAt) ? createdAt : Date.now()
  return {
    id,
    recurringId,
    scheduledDate: scheduledDate as string,
    status: status as PendingOccurrence['status'],
    ...(isId(transactionId) ? { transactionId } : {}),
    createdAt: stamp,
    updatedAt: isTimestamp(updatedAt) ? updatedAt : stamp,
  }
}

/** Запись истории импорта (v6). Сам файл в копии не хранится. */
function parseImportHistory(value: unknown): ImportHistory | null {
  if (!isObject(value)) return null
  const { id, fileName, accountId, importedAt, count, skippedCount, duplicateCount, errorCount, rolledBackAt } = value
  if (!isId(id) || !isText(fileName) || !isId(accountId) || !isTimestamp(importedAt)) return null
  const counter = (raw: unknown) => (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0)
  return {
    id,
    fileName,
    accountId,
    importedAt,
    count: counter(count),
    skippedCount: counter(skippedCount),
    duplicateCount: counter(duplicateCount),
    errorCount: counter(errorCount),
    ...(isTimestamp(rolledBackAt) ? { rolledBackAt } : {}),
  }
}

/** Правило категории (v6). Ссылки на категорию и счёт чинит ремонт после восстановления. */
function parseCategoryRule(value: unknown): CategoryRule | null {
  if (!isObject(value)) return null
  const { id, name, enabled, matchType, pattern, categoryId, accountId, priority, createdAt, updatedAt } = value
  if (!isId(id) || !isText(pattern) || pattern.trim() === '' || !isId(categoryId)) return null
  if (typeof matchType !== 'string' || !RULE_MATCH_TYPES.has(matchType)) return null
  if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0 || priority > 999) return null

  const stamp = isTimestamp(createdAt) ? createdAt : Date.now()
  return {
    id,
    name: isText(name) && name.trim() !== '' ? name : pattern,
    enabled: enabled !== false,
    matchType: matchType as CategoryRule['matchType'],
    pattern,
    categoryId,
    ...(isId(accountId) ? { accountId } : {}),
    priority,
    createdAt: stamp,
    updatedAt: isTimestamp(updatedAt) ? updatedAt : stamp,
  }
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

  const brokenGoals = data.savingsGoals.filter(
    (goal) => goal.linkedAccountId !== undefined && !accounts.has(goal.linkedAccountId),
  ).length
  const brokenRules = data.categoryRules.filter(
    (rule) => !categories.has(rule.categoryId) || (rule.accountId !== undefined && !accounts.has(rule.accountId)),
  ).length

  return (
    data.transactions.filter(isBroken).length +
    data.recurringTransactions.filter(isBroken).length +
    brokenGoals +
    brokenRules
  )
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

  // Копия v0.1 могла держать таблицы прямо в корне файла
  const legacySource = isObject(raw.data) ? raw.data : raw
  // Сначала — к актуальной версии формата, шаг за шагом; потом — строгий разбор
  const { data: source, steps } = migrateBackupData(legacySource, schemaVersion)

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

  const pendingOccurrences = parseList(source.pendingOccurrences, parsePendingOccurrence, 'ожидающие операции')
  if (typeof pendingOccurrences === 'string') return { ok: false, error: pendingOccurrences }

  const savingsGoals = parseList(source.savingsGoals, parseSavingsGoal, 'цели')
  if (typeof savingsGoals === 'string') return { ok: false, error: savingsGoals }

  const budgetTemplates = parseList(source.budgetTemplates, parseBudgetTemplate, 'шаблоны бюджета')
  if (typeof budgetTemplates === 'string') return { ok: false, error: budgetTemplates }

  const importHistory = parseList(source.importHistory, parseImportHistory, 'история импорта')
  if (typeof importHistory === 'string') return { ok: false, error: importHistory }

  const categoryRules = parseList(source.categoryRules, parseCategoryRule, 'правила категорий')
  if (typeof categoryRules === 'string') return { ok: false, error: categoryRules }

  // Лимиты v1, перенесённые миграцией, могут дублировать друг друга:
  // дубли не схлопываем, их найдёт validateBackup и откажет от файла целиком
  const parsed: BackupData = {
    accounts,
    categories,
    transactions,
    budgets,
    categoryBudgets,
    recurringTransactions,
    pendingOccurrences,
    savingsGoals,
    budgetTemplates,
    importHistory,
    categoryRules,
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
    migrationSteps: steps,
  }
}
