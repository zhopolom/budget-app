import type { AppSettings } from '../../types/entities'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'

export const SETTINGS_ID = 'app' as const

export function createDefaultSettings(): AppSettings {
  return {
    id: SETTINGS_ID,
    baseCurrency: 'UAH',
    theme: 'system',
    lastAccountId: DEFAULT_ACCOUNT_IDS.card,
  }
}
