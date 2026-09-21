import type { Category, CategoryType, Timestamp } from '../../types/entities'

/** Стабильные id системных категорий — не меняются между установками и в бэкапах. */
export const SYSTEM_CATEGORY_IDS = {
  groceries: 'cat-exp-groceries',
  transport: 'cat-exp-transport',
  cafe: 'cat-exp-cafe',
  entertainment: 'cat-exp-entertainment',
  subscriptions: 'cat-exp-subscriptions',
  shopping: 'cat-exp-shopping',
  tech: 'cat-exp-tech',
  health: 'cat-exp-health',
  home: 'cat-exp-home',
  expenseOther: 'cat-exp-other',
  salary: 'cat-inc-salary',
  gifts: 'cat-inc-gifts',
  transfers: 'cat-inc-transfers',
  incomeOther: 'cat-inc-other',
} as const

type Seed = readonly [id: string, name: string, icon: string, type: CategoryType]

const SEEDS: readonly Seed[] = [
  [SYSTEM_CATEGORY_IDS.groceries, 'Продукты', '🛒', 'expense'],
  [SYSTEM_CATEGORY_IDS.transport, 'Транспорт', '🚕', 'expense'],
  [SYSTEM_CATEGORY_IDS.cafe, 'Кафе', '☕', 'expense'],
  [SYSTEM_CATEGORY_IDS.entertainment, 'Развлечения', '🎬', 'expense'],
  [SYSTEM_CATEGORY_IDS.subscriptions, 'Подписки', '🔁', 'expense'],
  [SYSTEM_CATEGORY_IDS.shopping, 'Покупки', '🛍️', 'expense'],
  [SYSTEM_CATEGORY_IDS.tech, 'Техника', '💻', 'expense'],
  [SYSTEM_CATEGORY_IDS.health, 'Здоровье', '💊', 'expense'],
  [SYSTEM_CATEGORY_IDS.home, 'Дом', '🏠', 'expense'],
  [SYSTEM_CATEGORY_IDS.expenseOther, 'Другое', '📦', 'expense'],
  [SYSTEM_CATEGORY_IDS.salary, 'Зарплата', '💰', 'income'],
  [SYSTEM_CATEGORY_IDS.gifts, 'Подарки', '🎁', 'income'],
  [SYSTEM_CATEGORY_IDS.transfers, 'Переводы', '💸', 'income'],
  [SYSTEM_CATEGORY_IDS.incomeOther, 'Другое', '✨', 'income'],
]

export function createDefaultCategories(now: Timestamp): Category[] {
  // +index сохраняет исходный порядок при сортировке по createdAt
  return SEEDS.map(([id, name, icon, type], index) => ({
    id,
    name,
    icon,
    type,
    isSystem: true,
    createdAt: now + index,
  }))
}

/** Для операций, чья категория была удалена. */
export const MISSING_CATEGORY = { name: 'Без категории', icon: '❔' } as const
