import { describe, expect, it } from 'vitest'
import { fingerprint } from './fingerprint'

const base = { date: '2026-09-21', amount: 43_000, type: 'expense' as const, accountId: 'acc-card', description: 'ATB Market' }

describe('fingerprint', () => {
  it('детерминирован и не зависит от регистра и пробелов в описании', () => {
    expect(fingerprint(base)).toBe(fingerprint({ ...base }))
    expect(fingerprint(base)).toBe(fingerprint({ ...base, description: '  atb   MARKET ' }))
    expect(fingerprint(base)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('меняется от даты, суммы, типа, счёта и описания', () => {
    expect(fingerprint({ ...base, date: '2026-09-22' })).not.toBe(fingerprint(base))
    expect(fingerprint({ ...base, amount: 43_001 })).not.toBe(fingerprint(base))
    expect(fingerprint({ ...base, type: 'income' })).not.toBe(fingerprint(base))
    expect(fingerprint({ ...base, accountId: 'acc-cash' })).not.toBe(fingerprint(base))
    expect(fingerprint({ ...base, description: 'Сільпо' })).not.toBe(fingerprint(base))
  })
})
