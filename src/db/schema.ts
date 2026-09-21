/**
 * Индексы Dexie по версиям схемы. Первым идёт первичный ключ.
 * Индексируем только поля, по которым реально фильтруем или сортируем —
 * остальные поля объектов хранятся без индекса.
 *
 * Схему прошлых версий не редактируем: для изменений добавляем SCHEMA_V2 и миграцию.
 */
export const SCHEMA_V1 = {
  accounts: 'id, createdAt',
  categories: 'id, type, createdAt',
  transactions: 'id, date, [date+createdAt], type, categoryId, accountId',
  budgets: 'id, &[year+month]',
  settings: 'id',
} as const satisfies Record<string, string>
