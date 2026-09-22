import type { BackupData } from './format'

/**
 * Проверки копии, которые нельзя делать по одной записи: уникальность
 * ключей и согласованность ссылок между разделами.
 *
 * Выполняются до открытия транзакции. Дубль первичного ключа уронил бы
 * bulkAdd уже внутри неё — база откатилась бы, но пользователь увидел бы
 * сырую ошибку Dexie. Здесь ошибка называется по-человечески, а подробности
 * уходят в консоль разработчика: в них есть id, но нет сумм и заметок.
 */

export type BackupValidation =
  | { ok: true }
  | {
      ok: false
      /** Что сказать пользователю. */
      error: string
      /** Что вывести в консоль разработчика: id и ключи без финансовых данных. */
      details: string[]
    }

const DUPLICATE_ERROR = 'Резервная копия содержит повторяющиеся записи.'
const REFERENCE_ERROR = 'Резервная копия ссылается на записи, которых в ней нет.'

/** Ключи, встретившиеся больше одного раза. */
function duplicatesOf(keys: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const key of keys) {
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }
  return [...duplicates]
}

function findDuplicates(data: BackupData): string[] {
  const details: string[] = []
  const report = (section: string, keys: readonly string[]) => {
    for (const key of duplicatesOf(keys)) details.push(`${section}: ${key}`)
  }

  report('accounts.id', data.accounts.map((item) => item.id))
  report('categories.id', data.categories.map((item) => item.id))
  report('transactions.id', data.transactions.map((item) => item.id))
  report('budgets.id', data.budgets.map((item) => item.id))
  report('categoryBudgets.id', data.categoryBudgets.map((item) => item.id))
  report('recurringTransactions.id', data.recurringTransactions.map((item) => item.id))
  report('pendingOccurrences.id', data.pendingOccurrences.map((item) => item.id))
  report('savingsGoals.id', data.savingsGoals.map((item) => item.id))
  report('budgetTemplates.id', data.budgetTemplates.map((item) => item.id))
  // Два лимита на одну категорию внутри шаблона применить нельзя однозначно
  for (const template of data.budgetTemplates) {
    report(`budgetTemplates[${template.id}].categoryId`, template.categoryLimits.map((limit) => limit.categoryId))
  }

  // Составные уникальные индексы базы: один бюджет на месяц, один лимит на
  // категорию в месяц, одна операция на вхождение расписания
  report('budgets[year+month]', data.budgets.map((item) => `${item.year}-${item.month}`))
  report(
    'categoryBudgets[year+month+categoryId]',
    data.categoryBudgets.map((item) => `${item.year}-${item.month}:${item.categoryId}`),
  )
  report(
    'transactions[recurringId+occurrenceDate]',
    data.transactions
      .filter((item) => item.recurringId !== undefined && item.occurrenceDate !== undefined)
      .map((item) => `${item.recurringId}@${item.occurrenceDate}`),
  )
  report(
    'pendingOccurrences[recurringId+scheduledDate]',
    data.pendingOccurrences.map((item) => `${item.recurringId}@${item.scheduledDate}`),
  )

  return details
}

/**
 * Ссылки, которые ремонт не чинит и которые в настоящей копии невозможны.
 * Битые ссылки операций и расписаний на счета и категории сюда не входят:
 * они бывают в настоящих данных (баг v0.2) и чинятся с явным предупреждением.
 */
function findBrokenReferences(data: BackupData): string[] {
  const categories = new Set(data.categories.map((item) => item.id))
  const details: string[] = []

  for (const limit of data.categoryBudgets) {
    if (!categories.has(limit.categoryId)) details.push(`categoryBudgets.categoryId: ${limit.id}`)
  }

  return details
}

export function validateBackup(data: BackupData): BackupValidation {
  const duplicates = findDuplicates(data)
  if (duplicates.length > 0) return { ok: false, error: DUPLICATE_ERROR, details: duplicates }

  const references = findBrokenReferences(data)
  if (references.length > 0) return { ok: false, error: REFERENCE_ERROR, details: references }

  return { ok: true }
}
