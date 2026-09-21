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

  /** Операции остаются: в интерфейсе они показываются как «Без категории». */
  async remove(id: Id): Promise<void> {
    await db.transaction('rw', db.categories, async () => {
      await getCustom(id)
      await db.categories.delete(id)
    })
  },
}
