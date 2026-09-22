import { describe, expect, it } from 'vitest'
import type { CategoryRule } from '../../types/entities'
import { compileRules, countMatches, matchesPattern, pickRule } from './matching'

let counter = 0
function rule(patch: Partial<CategoryRule>): CategoryRule {
  counter += 1
  return {
    id: `rule-${counter}`,
    name: patch.pattern ?? 'правило',
    enabled: true,
    matchType: 'contains',
    pattern: 'atb',
    categoryId: 'cat-groceries',
    priority: 10,
    createdAt: counter,
    updatedAt: counter,
    ...patch,
  }
}

describe('matchesPattern', () => {
  it('contains, startsWith, exact', () => {
    expect(matchesPattern('contains', 'atb', 'покупка atb маркет')).toBe(true)
    expect(matchesPattern('startsWith', 'atb', 'atb маркет')).toBe(true)
    expect(matchesPattern('startsWith', 'atb', 'покупка atb')).toBe(false)
    expect(matchesPattern('exact', 'atb', 'atb')).toBe(true)
    expect(matchesPattern('exact', 'atb', 'atb маркет')).toBe(false)
    expect(matchesPattern('contains', '', 'что угодно')).toBe(false)
  })
})

describe('pickRule', () => {
  it('сопоставляет без учёта регистра и лишних пробелов', () => {
    const compiled = compileRules([rule({ pattern: '  SPOTIFY ', categoryId: 'cat-subscriptions' })])
    expect(pickRule(compiled, 'Spotify   Premium')?.categoryId).toBe('cat-subscriptions')
    expect(pickRule(compiled, 'УБЕР')).toBeNull()
    expect(pickRule(compiled, '')).toBeNull()
  })

  it('при нескольких подходящих правилах побеждает приоритет, при равном — более раннее', () => {
    const generic = rule({ pattern: 'market', categoryId: 'cat-shopping', priority: 5 })
    const specific = rule({ pattern: 'atb market', categoryId: 'cat-groceries', priority: 20 })
    const sameEarlier = rule({ pattern: 'atb', categoryId: 'cat-earlier', priority: 20, createdAt: 1 })

    const compiled = compileRules([generic, specific, sameEarlier])
    expect(pickRule(compiled, 'ATB Market Kyiv')?.categoryId).toBe('cat-earlier')
    expect(pickRule(compiled, 'Silpo market')?.categoryId).toBe('cat-shopping')
  })

  it('порядок в массиве (как в IndexedDB) не влияет на результат', () => {
    const low = rule({ pattern: 'uber', categoryId: 'cat-low', priority: 1 })
    const high = rule({ pattern: 'uber', categoryId: 'cat-high', priority: 50 })
    expect(pickRule(compileRules([low, high]), 'Uber trip')?.categoryId).toBe('cat-high')
    expect(pickRule(compileRules([high, low]), 'Uber trip')?.categoryId).toBe('cat-high')
  })

  it('выключенные правила и пустые шаблоны не участвуют', () => {
    const compiled = compileRules([rule({ pattern: 'atb', enabled: false }), rule({ pattern: '   ' })])
    expect(compiled).toEqual([])
    expect(pickRule(compiled, 'atb')).toBeNull()
  })

  it('правило со счётом подходит только операциям этого счёта', () => {
    const compiled = compileRules([rule({ pattern: 'atb', accountId: 'acc-card', categoryId: 'cat-card-only' })])
    expect(pickRule(compiled, 'atb', 'acc-card')?.categoryId).toBe('cat-card-only')
    expect(pickRule(compiled, 'atb', 'acc-cash')).toBeNull()
    expect(pickRule(compiled, 'atb')).toBeNull()
  })
})

describe('countMatches', () => {
  it('считает подходящие описания для превью', () => {
    const items = [
      { description: 'ATB Market', accountId: 'acc-card' },
      { description: 'atb', accountId: 'acc-cash' },
      { description: 'Silpo', accountId: 'acc-card' },
    ]
    expect(countMatches({ matchType: 'contains', pattern: 'ATB' }, items)).toBe(2)
    expect(countMatches({ matchType: 'exact', pattern: 'atb' }, items)).toBe(1)
    expect(countMatches({ matchType: 'contains', pattern: 'atb', accountId: 'acc-card' }, items)).toBe(1)
    expect(countMatches({ matchType: 'contains', pattern: '' }, items)).toBe(0)
  })
})
