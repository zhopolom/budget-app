import { db } from '../../db/database'
import type { CategoryRule, Id } from '../../types/entities'
import { createId } from '../../utils/id'
import { isEntry } from '../transactions/model'
import { countMatches } from './matching'
import { RULE_PRIORITY_MAX, RULE_PRIORITY_MIN, type CategoryRuleInput } from './validation'

function assertInput(input: CategoryRuleInput): void {
  if (input.pattern.trim() === '') throw new Error('Введите текст для поиска')
  if (!Number.isInteger(input.priority) || input.priority < RULE_PRIORITY_MIN || input.priority > RULE_PRIORITY_MAX) {
    throw new RangeError('Приоритет вне допустимых пределов')
  }
}

function fieldsOf(input: CategoryRuleInput): Omit<CategoryRule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: input.name,
    enabled: input.enabled,
    matchType: input.matchType,
    pattern: input.pattern,
    categoryId: input.categoryId,
    ...(input.accountId === null ? {} : { accountId: input.accountId }),
    priority: input.priority,
  }
}

/** Проверка ссылок внутри транзакции: правило на несуществующую категорию — висячая ссылка. */
async function assertReferences(input: CategoryRuleInput): Promise<void> {
  if (!(await db.categories.get(input.categoryId))) throw new Error('Категория не найдена')
  if (input.accountId !== null && !(await db.accounts.get(input.accountId))) throw new Error('Счёт не найден')
}

export const categoryRulesRepository = {
  /** По приоритету вниз, при равном — старые первыми: тот же порядок, в котором правила применяются. */
  async listAll(): Promise<CategoryRule[]> {
    const rules = await db.categoryRules.toArray()
    return rules.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
  },

  get(id: Id): Promise<CategoryRule | undefined> {
    return db.categoryRules.get(id)
  },

  async create(input: CategoryRuleInput): Promise<CategoryRule> {
    assertInput(input)
    return db.transaction('rw', db.categoryRules, db.categories, db.accounts, async () => {
      await assertReferences(input)
      const now = Date.now()
      const rule: CategoryRule = { ...fieldsOf(input), id: createId(), createdAt: now, updatedAt: now }
      await db.categoryRules.add(rule)
      return rule
    })
  },

  async update(id: Id, input: CategoryRuleInput): Promise<void> {
    assertInput(input)
    await db.transaction('rw', db.categoryRules, db.categories, db.accounts, async () => {
      const existing = await db.categoryRules.get(id)
      if (!existing) throw new Error('Правило не найдено')
      await assertReferences(input)
      await db.categoryRules.put({ ...fieldsOf(input), id, createdAt: existing.createdAt, updatedAt: Date.now() })
    })
  },

  async setEnabled(id: Id, enabled: boolean): Promise<void> {
    const updated = await db.categoryRules.update(id, { enabled, updatedAt: Date.now() })
    if (updated === 0) throw new Error('Правило не найдено')
  },

  remove(id: Id): Promise<void> {
    return db.categoryRules.delete(id)
  },

  /**
   * Сколько существующих расходов и доходов подходит под правило (ТЗ §59).
   * Только подсчёт: прошлые операции правило не трогает.
   */
  async previewMatches(rule: Pick<CategoryRule, 'matchType' | 'pattern' | 'accountId'>): Promise<number> {
    const transactions = await db.transactions.toArray()
    const items = transactions.flatMap((transaction) =>
      isEntry(transaction) ? [{ description: transaction.note, accountId: transaction.accountId }] : [],
    )
    return countMatches(rule, items)
  },

  /** При удалении категории: правила на неё либо переезжают на замену, либо удаляются. */
  async replaceCategory(sourceId: Id, targetId: Id | null): Promise<number> {
    const rules = await db.categoryRules.where('categoryId').equals(sourceId).toArray()
    for (const rule of rules) {
      if (targetId === null) await db.categoryRules.delete(rule.id)
      else await db.categoryRules.update(rule.id, { categoryId: targetId, updatedAt: Date.now() })
    }
    return rules.length
  },

  /** При удалении счёта: ограничение по счёту переезжает на замену или снимается — правило становится общим. */
  async replaceAccount(sourceId: Id, targetId: Id | null): Promise<number> {
    const rules = await db.categoryRules.where('accountId').equals(sourceId).toArray()
    for (const rule of rules) {
      const { accountId: _dropped, ...rest } = rule
      await db.categoryRules.put(
        targetId === null ? { ...rest, updatedAt: Date.now() } : { ...rule, accountId: targetId, updatedAt: Date.now() },
      )
    }
    return rules.length
  },
}
