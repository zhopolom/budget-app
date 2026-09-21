import type { AccountType } from '../../types/entities'

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  card: 'Карта',
  cash: 'Наличные',
  savings: 'Накопления',
  other: 'Другое',
}

export const ACCOUNT_TYPE_ICONS: Record<AccountType, string> = {
  card: '💳',
  cash: '💵',
  savings: '🏦',
  other: '👛',
}

export const ACCOUNT_TYPES: readonly AccountType[] = ['card', 'cash', 'savings', 'other']
