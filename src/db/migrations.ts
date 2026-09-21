import type { Transaction as DexieTransaction } from 'dexie'
import { categoryBudgetIdFor } from '../features/budgets/ids'
import type { Budget, CategoryBudget } from '../types/entities'
import { SCHEMA_V1, SCHEMA_V2 } from './schema'

export interface Migration {
  version: number
  description: string
  /** Таблицы, которые появились или изменили индексы. null — удалить таблицу. */
  stores: Record<string, string | null>
  /** Преобразование данных при переходе на эту версию. */
  upgrade?: (tx: DexieTransaction) => Promise<void> | void
}

/**
 * Переносит лимиты категорий из устаревшего поля Budget.categoryLimits
 * в отдельную таблицу categoryBudgets.
 *
 * Идемпотентно: id лимита детерминированный, запись идёт через bulkPut,
 * поэтому повторный прогон миграции ничего не задваивает и не теряет.
 */
async function moveCategoryLimits(tx: DexieTransaction): Promise<void> {
  const now = Date.now()
  const budgets = (await tx.table('budgets').toArray()) as Budget[]
  const moved: CategoryBudget[] = []

  for (const budget of budgets) {
    for (const legacy of budget.categoryLimits ?? []) {
      if (!legacy?.categoryId || !Number.isSafeInteger(legacy.limit) || legacy.limit <= 0) continue
      const ym = { year: budget.year, month: budget.month }
      moved.push({
        id: categoryBudgetIdFor(ym, legacy.categoryId),
        categoryId: legacy.categoryId,
        month: budget.month,
        year: budget.year,
        limitAmount: legacy.limit,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  if (moved.length > 0) await tx.table('categoryBudgets').bulkPut(moved)

  // Снимаем устаревшее поле: два источника лимитов разошлись бы при первом же редактировании
  await tx
    .table('budgets')
    .toCollection()
    .filter((budget: Budget) => budget.categoryLimits !== undefined)
    .modify((budget: Budget) => {
      delete budget.categoryLimits
    })
}

/**
 * История схемы. Новые версии только добавляются в конец.
 *
 * Пример будущей миграции:
 * {
 *   version: 3,
 *   description: 'Архивирование счетов',
 *   stores: { accounts: 'id, createdAt, archivedAt' },
 *   upgrade: async (tx) => {
 *     await tx.table('accounts').toCollection().modify((account) => {
 *       account.archivedAt = null
 *     })
 *   },
 * }
 */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    description: 'Начальная схема: счета, категории, операции, бюджеты, настройки',
    stores: SCHEMA_V1,
  },
  {
    version: 2,
    description: 'Переводы между счетами, лимиты категорий, регулярные операции',
    stores: SCHEMA_V2,
    /**
     * Операции v0.1 — это расходы и доходы с accountId и categoryId, то есть
     * уже готовые EntryTransaction: переписывать их не нужно и нельзя.
     * Единственное преобразование данных — переезд лимитов категорий.
     */
    upgrade: moveCategoryLimits,
  },
]

export const DB_VERSION = migrations[migrations.length - 1].version

if (import.meta.env.DEV) {
  migrations.forEach((migration, index) => {
    const previous = migrations[index - 1]
    if (previous && migration.version <= previous.version) {
      throw new Error(`Миграции должны идти по возрастанию версий: ${previous.version} → ${migration.version}`)
    }
  })
}
