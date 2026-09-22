import { categoryBudgetIdFor } from '../budgets/ids'
import { BACKUP_SCHEMA_VERSION } from './format'

/**
 * Миграции формата резервной копии (ТЗ §68): копия любой прошлой версии
 * проходит цепочку шагов v1 → v2 → v3 → v4 и только потом попадает в разбор.
 *
 * Каждый шаг работает с сырым JSON: ничего не знает о типах приложения,
 * ничего не проверяет и не отбрасывает — это работа разбора после него.
 * Шаг не трогает ни одной суммы и ни одной операции: он добавляет то, чего
 * в старом формате не было, и переносит то, что лежало в другом месте.
 *
 * Старые шаги не редактируются: копия v1 должна читаться одинаково и в 0.4,
 * и в 0.6. Новый формат — новый шаг в конце цепочки.
 */

export type RawBackupData = Record<string, unknown>

export interface BackupMigration {
  /** Версия формата, с которой шаг начинается. */
  from: number
  /** Версия, которую он даёт на выходе. */
  to: number
  description: string
  migrate: (data: RawBackupData) => RawBackupData
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isMonth = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12

const isYear = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1970 && value <= 9999

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/**
 * v1 → v2: лимиты категорий лежали внутри бюджета (budgets[].categoryLimits),
 * в v2 у них своя таблица categoryBudgets. Записи получают тот же
 * детерминированный id, что и в базе, поэтому повторный прогон ничего не
 * задваивает. Мусорные лимиты (без категории, с нулём) пропускаются —
 * так же поступала миграция базы v2.
 *
 * Появившиеся в v2 разделы (categoryBudgets, recurringTransactions) добавляются
 * пустыми, если их не было.
 */
export function migrateBackupV1ToV2(data: RawBackupData): RawBackupData {
  const now = Date.now()
  const moved: Record<string, unknown>[] = []
  const budgets = listOf(data.budgets).map((budget) => {
    if (!isObject(budget)) return budget
    const { categoryLimits, ...rest } = budget
    if (Array.isArray(categoryLimits) && isMonth(budget.month) && isYear(budget.year)) {
      const ym = { year: budget.year, month: budget.month }
      for (const legacy of categoryLimits) {
        if (!isObject(legacy) || typeof legacy.categoryId !== 'string' || legacy.categoryId === '') continue
        if (typeof legacy.limit !== 'number' || !Number.isSafeInteger(legacy.limit) || legacy.limit <= 0) continue
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
    return rest
  })

  return {
    ...data,
    budgets,
    categoryBudgets: [...listOf(data.categoryBudgets), ...moved],
    recurringTransactions: listOf(data.recurringTransactions),
  }
}

/**
 * v2 → v3: появились регулярные переводы (type: 'transfer' у расписаний).
 * Это новый вариант записи, а не новое поле у старых: копии v2 переносятся
 * как есть. Шаг существует, чтобы цепочка была полной и версия росла честно.
 */
export function migrateBackupV2ToV3(data: RawBackupData): RawBackupData {
  return { ...data }
}

/**
 * v3 → v4: у расписаний появился режим срабатывания, у копии — раздел
 * ожидающих вхождений. Правила до 0.4 срабатывали только автоматически —
 * так и записываем; уже размеченные (например, из отредактированного файла)
 * не трогаем. Корректировки остатка — новый тип операции, переносить нечего.
 */
export function migrateBackupV3ToV4(data: RawBackupData): RawBackupData {
  const recurringTransactions = listOf(data.recurringTransactions).map((rule) => {
    if (!isObject(rule)) return rule
    if (rule.executionMode === 'automatic' || rule.executionMode === 'confirm') return rule
    return { ...rule, executionMode: 'automatic' }
  })

  return {
    ...data,
    recurringTransactions,
    pendingOccurrences: listOf(data.pendingOccurrences),
  }
}

/**
 * v4 → v5: цели накоплений и шаблоны бюджета — новые разделы, пустые у старых
 * копий. Флаг переноса остатка у лимитов необязателен: его отсутствие и есть
 * «не переносить», поэтому лимиты не трогаем.
 */
export function migrateBackupV4ToV5(data: RawBackupData): RawBackupData {
  return {
    ...data,
    savingsGoals: listOf(data.savingsGoals),
    budgetTemplates: listOf(data.budgetTemplates),
  }
}

/** Цепочка по порядку. Новые шаги добавляются в конец. */
export const backupMigrations: readonly BackupMigration[] = [
  { from: 1, to: 2, description: 'Лимиты категорий — в отдельный раздел', migrate: migrateBackupV1ToV2 },
  { from: 2, to: 3, description: 'Регулярные переводы', migrate: migrateBackupV2ToV3 },
  { from: 3, to: 4, description: 'Режим подтверждения и ожидающие вхождения', migrate: migrateBackupV3ToV4 },
  { from: 4, to: 5, description: 'Цели накоплений и шаблоны бюджета', migrate: migrateBackupV4ToV5 },
]

if (import.meta.env.DEV) {
  backupMigrations.forEach((migration, index) => {
    const expectedFrom = index === 0 ? 1 : backupMigrations[index - 1].to
    if (migration.from !== expectedFrom || migration.to !== migration.from + 1) {
      throw new Error(`Миграции копии должны идти подряд: шаг ${migration.from} → ${migration.to}`)
    }
  })
  if (backupMigrations[backupMigrations.length - 1].to !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`Последняя миграция копии должна давать версию ${BACKUP_SCHEMA_VERSION}`)
  }
}

export interface MigratedBackup {
  data: RawBackupData
  /** Версии, через которые прошла копия: [2, 3, 4] для файла v1, [] для актуального. */
  steps: number[]
}

/**
 * Проводит сырые данные копии версии fromVersion через все недостающие шаги.
 * Версии новее текущей сюда не попадают — их отклоняет разбор до вызова.
 */
export function migrateBackupData(data: RawBackupData, fromVersion: number): MigratedBackup {
  let current = data
  const steps: number[] = []
  for (const migration of backupMigrations) {
    if (migration.from < fromVersion) continue
    current = migration.migrate(current)
    steps.push(migration.to)
  }
  return { data: current, steps }
}
