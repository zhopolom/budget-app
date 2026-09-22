import { db } from '../../db/database'
import type { Category, Id } from '../../types/entities'
import { createId } from '../../utils/id'
import type { CategoryInput } from './validation'

async function getCustom(id: Id): Promise<Category> {
  const category = await db.categories.get(id)
  if (!category) throw new Error('Категория не найдена')
  if (category.isSystem) throw new Error('Системные категории нельзя менять')
  return category
}

/** Где ещё встречается категория, кроме операций. */
async function countRecurring(categoryId: Id): Promise<number> {
  // Индекс categoryId заведён в схеме v3; переводы в него не попадают
  return db.recurringTransactions.where('categoryId').equals(categoryId).count()
}

export const categoriesRepository = {
  listAll(): Promise<Category[]> {
    return db.categories.orderBy('createdAt').toArray()
  },

  async create(input: CategoryInput): Promise<Category> {
    const category: Category = { ...input, id: createId(), isSystem: false, createdAt: Date.now() }
    await db.categories.add(category)
    return category
  },

  async update(id: Id, input: Pick<Category, 'name' | 'icon'>): Promise<void> {
    await db.transaction('rw', db.categories, async () => {
      await getCustom(id)
      await db.categories.update(id, { name: input.name, icon: input.icon })
    })
  },

  /** Сколько операций и регулярных платежей ссылается на категорию. */
  async countUsage(id: Id): Promise<{ transactions: number; recurring: number }> {
    const [transactions, recurring] = await Promise.all([
      db.transactions.where('categoryId').equals(id).count(),
      countRecurring(id),
    ])
    return { transactions, recurring }
  },

  /**
   * Удаляет неиспользуемую категорию. Если на неё что-то ссылается — ошибка:
   * битый categoryId в операциях оставлять нельзя, для этого есть replaceAndRemove.
   */
  async remove(id: Id): Promise<void> {
    await db.transaction('rw', db.categories, db.transactions, db.recurringTransactions, db.categoryBudgets, async () => {
      await getCustom(id)

      // Проверка внутри той же транзакции: между подсчётом и удалением
      // никто не успеет добавить операцию с этой категорией
      const usage = await categoriesRepository.countUsage(id)
      if (usage.transactions > 0 || usage.recurring > 0) {
        throw new Error('Категория используется — выберите, на какую её заменить')
      }

      await db.categoryBudgets.where('categoryId').equals(id).delete()
      await db.categories.delete(id)
    })
  },

  /**
   * Переносит операции и регулярные платежи на другую категорию и удаляет исходную.
   * Всё в одной транзакции Dexie: половина операций со старой категорией остаться
   * не может. Лимиты удаляемой категории снимаются — переносить их на чужой
   * лимит значило бы молча изменить бюджет.
   *
   * Возвращает число перенесённых операций.
   */
  async replaceAndRemove(sourceId: Id, targetId: Id): Promise<number> {
    if (sourceId === targetId) throw new Error('Выберите другую категорию')

    return db.transaction('rw', db.categories, db.transactions, db.recurringTransactions, db.categoryBudgets, async () => {
      const source = await getCustom(sourceId)
      const target = await db.categories.get(targetId)
      if (!target) throw new Error('Категория для переноса не найдена')
      if (target.type !== source.type) throw new Error('Категории разных типов')

      const now = Date.now()
      const moved = await db.transactions
        .where('categoryId')
        .equals(sourceId)
        .modify((transaction) => {
          if (transaction.type !== 'expense' && transaction.type !== 'income') return
          transaction.categoryId = targetId
          transaction.updatedAt = now
        })

      await db.recurringTransactions
        .where('categoryId')
        .equals(sourceId)
        .modify((rule) => {
          // Перевод в индекс categoryId не попадает, но сузить тип всё равно нужно
          if (rule.type === 'transfer') return
          rule.categoryId = targetId
          rule.updatedAt = now
        })

      // Контрольная проверка перед удалением: исключение здесь откатит всё
      const left = await categoriesRepository.countUsage(sourceId)
      if (left.transactions > 0 || left.recurring > 0) throw new Error('Перенос операций не завершён')

      await db.categoryBudgets.where('categoryId').equals(sourceId).delete()
      await db.categories.delete(sourceId)

      return moved
    })
  },
}
