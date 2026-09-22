import type { Account, Category, CategoryRule, Id, RuleMatchType } from '../../types/entities'
import type { ValidationResult } from '../../types/validation'
import { normalizeDescription } from '../import/normalize'

export const RULE_NAME_MAX_LENGTH = 40
export const RULE_PATTERN_MAX_LENGTH = 80
export const RULE_PRIORITY_MIN = 0
export const RULE_PRIORITY_MAX = 999
export const RULE_PRIORITY_DEFAULT = 10

export type CategoryRuleInput = Pick<CategoryRule, 'name' | 'enabled' | 'matchType' | 'pattern' | 'categoryId' | 'priority'> & {
  accountId: Id | null
}

export interface RuleDraft {
  name: string
  enabled: boolean
  matchType: RuleMatchType
  pattern: string
  categoryId: Id | null
  accountId: Id | null
  priorityText: string
}

export type RuleField = 'name' | 'pattern' | 'category' | 'account' | 'priority'

export function validateRuleDraft(
  draft: RuleDraft,
  categories: readonly Category[],
  accounts: readonly Account[],
): ValidationResult<CategoryRuleInput, RuleField> {
  const errors: Partial<Record<RuleField, string>> = {}

  const pattern = draft.pattern.trim()
  if (normalizeDescription(pattern) === '') errors.pattern = 'Введите текст для поиска'
  else if (pattern.length > RULE_PATTERN_MAX_LENGTH) errors.pattern = `Не длиннее ${RULE_PATTERN_MAX_LENGTH} символов`

  // Имя необязательно: без него правило называется своим шаблоном
  const name = draft.name.trim() || pattern
  if (name.length > RULE_NAME_MAX_LENGTH) errors.name = `Не длиннее ${RULE_NAME_MAX_LENGTH} символов`

  const category = categories.find((item) => item.id === draft.categoryId)
  if (!category) errors.category = 'Выберите категорию'

  const account = draft.accountId === null ? null : accounts.find((item) => item.id === draft.accountId)
  if (draft.accountId !== null && !account) errors.account = 'Выберите счёт'

  const priority = Number(draft.priorityText)
  if (!Number.isInteger(priority) || priority < RULE_PRIORITY_MIN || priority > RULE_PRIORITY_MAX) {
    errors.priority = `Приоритет от ${RULE_PRIORITY_MIN} до ${RULE_PRIORITY_MAX}`
  }

  if (Object.keys(errors).length > 0 || !category) return { ok: false, errors }
  return {
    ok: true,
    value: {
      name,
      enabled: draft.enabled,
      matchType: draft.matchType,
      pattern,
      categoryId: category.id,
      accountId: account?.id ?? null,
      priority,
    },
  }
}

export function draftFromRule(rule: CategoryRule | null, defaults: Partial<RuleDraft> = {}): RuleDraft {
  if (!rule) {
    return {
      name: '',
      enabled: true,
      matchType: 'contains',
      pattern: '',
      categoryId: null,
      accountId: null,
      priorityText: String(RULE_PRIORITY_DEFAULT),
      ...defaults,
    }
  }
  return {
    name: rule.name,
    enabled: rule.enabled,
    matchType: rule.matchType,
    pattern: rule.pattern,
    categoryId: rule.categoryId,
    accountId: rule.accountId ?? null,
    priorityText: String(rule.priority),
  }
}
