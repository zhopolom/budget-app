/**
 * Индексы Dexie по версиям схемы. Первым идёт первичный ключ.
 * Индексируем только поля, по которым реально фильтруем или сортируем —
 * остальные поля объектов хранятся без индекса.
 *
 * Схему прошлых версий не редактируем: для изменений добавляется следующая
 * SCHEMA_V* с изменившимися и новыми таблицами и миграция к ней.
 */
export const SCHEMA_V1 = {
  accounts: 'id, createdAt',
  categories: 'id, type, createdAt',
  transactions: 'id, date, [date+createdAt], type, categoryId, accountId',
  budgets: 'id, &[year+month]',
  settings: 'id',
} as const satisfies Record<string, string>

/**
 * v2 — переводы, лимиты категорий, регулярные операции.
 * Перечислены только изменившиеся и новые таблицы: остальные Dexie берёт из v1.
 *
 * transactions:
 *   fromAccountId / toAccountId — счета перевода; у расхода и дохода их нет,
 *   такие записи в эти индексы просто не попадают.
 *   &[recurringId+occurrenceDate] — защита от дублей регулярных операций.
 *   IndexedDB не индексирует составной ключ, если хоть одна часть undefined,
 *   поэтому обычные операции уникальности не нарушают.
 *
 * recurringTransactions:
 *   isActive не индексируем — IndexedDB не умеет булевы ключи. Отбор идёт по
 *   nextOccurrence, активность проверяется уже в коде (таблица маленькая).
 */
export const SCHEMA_V2 = {
  transactions:
    'id, date, [date+createdAt], type, categoryId, accountId, fromAccountId, toAccountId, &[recurringId+occurrenceDate]',
  categoryBudgets: 'id, &[year+month+categoryId], categoryId, [year+month]',
  recurringTransactions: 'id, nextOccurrence, createdAt',
} as const satisfies Record<string, string>

/**
 * v3 — регулярные переводы и ссылки на счета у расписаний.
 *
 * Индексы по accountId, fromAccountId, toAccountId и categoryId нужны, чтобы
 * удаление счёта и категории находило зависимые правила запросом к индексу,
 * а не перебором всей таблицы. Ровно из-за их отсутствия в v2 удаление счёта
 * вообще не замечало расписаний.
 */
export const SCHEMA_V3 = {
  recurringTransactions: 'id, nextOccurrence, createdAt, accountId, fromAccountId, toAccountId, categoryId',
} as const satisfies Record<string, string>
