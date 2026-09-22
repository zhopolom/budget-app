import type { CategoryRule, Id, RuleMatchType } from '../../types/entities'
import { normalizeDescription } from '../import/normalize'

/**
 * Сопоставление правил категорий (ТЗ §55–§58). Всё регистронезависимо
 * и по нормализованному описанию: «  SPOTIFY  Premium» и «spotify premium»
 * — одно и то же. При нескольких подходящих правилах побеждает большее
 * priority, при равном — созданное раньше: порядок записей в IndexedDB
 * здесь ни при чём.
 */

export const RULE_MATCH_TYPE_LABELS: Record<RuleMatchType, string> = {
  contains: 'содержит',
  startsWith: 'начинается с',
  exact: 'совпадает целиком',
}

export const RULE_MATCH_TYPES: readonly RuleMatchType[] = ['contains', 'startsWith', 'exact']

export interface CompiledRule {
  rule: CategoryRule
  pattern: string
}

export function matchesPattern(matchType: RuleMatchType, pattern: string, normalizedDescription: string): boolean {
  if (pattern === '') return false
  switch (matchType) {
    case 'contains':
      return normalizedDescription.includes(pattern)
    case 'startsWith':
      return normalizedDescription.startsWith(pattern)
    case 'exact':
      return normalizedDescription === pattern
  }
}

/** Правила с нормализованными шаблонами в порядке применения — один раз на импорт, а не на строку. */
export function compileRules(rules: readonly CategoryRule[]): CompiledRule[] {
  return rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({ rule, pattern: normalizeDescription(rule.pattern) }))
    .filter((compiled) => compiled.pattern !== '')
    .sort((a, b) => b.rule.priority - a.rule.priority || a.rule.createdAt - b.rule.createdAt)
}

/** Первое подходящее правило по приоритету; правило со счётом подходит только операциям этого счёта. */
export function pickRule(compiled: readonly CompiledRule[], description: string, accountId?: Id): CategoryRule | null {
  const normalized = normalizeDescription(description)
  if (normalized === '') return null
  for (const { rule, pattern } of compiled) {
    if (rule.accountId !== undefined && rule.accountId !== accountId) continue
    if (matchesPattern(rule.matchType, pattern, normalized)) return rule
  }
  return null
}

/** Сколько описаний подходит под одно правило — для превью «совпадает с N операциями» (ТЗ §59). */
export function countMatches(
  rule: Pick<CategoryRule, 'matchType' | 'pattern' | 'accountId'>,
  items: readonly { description: string; accountId?: Id }[],
): number {
  const pattern = normalizeDescription(rule.pattern)
  if (pattern === '') return 0
  let count = 0
  for (const item of items) {
    if (rule.accountId !== undefined && rule.accountId !== item.accountId) continue
    if (matchesPattern(rule.matchType, pattern, normalizeDescription(item.description))) count += 1
  }
  return count
}
