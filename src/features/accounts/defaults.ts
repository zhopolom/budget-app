import type { Account, CurrencyCode, Timestamp } from '../../types/entities'

export const DEFAULT_ACCOUNT_IDS = {
  card: 'acc-card',
  cash: 'acc-cash',
} as const

export function createDefaultAccounts(now: Timestamp, currency: CurrencyCode): Account[] {
  return [
    {
      id: DEFAULT_ACCOUNT_IDS.card,
      name: 'Карта',
      type: 'card',
      initialBalance: 0,
      currency,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: DEFAULT_ACCOUNT_IDS.cash,
      name: 'Наличные',
      type: 'cash',
      initialBalance: 0,
      currency,
      createdAt: now + 1,
      updatedAt: now + 1,
    },
  ]
}
