import type { BackupData } from './format'

/**
 * Миграция копии в памяти — то, что приводит данные к инвариантам текущей
 * версии, не трогая ни одной суммы и ни одной операции.
 *
 * Каждое изменение считается и показывается пользователю до восстановления:
 * молча менять данные нельзя, даже когда это «просто нормализация».
 */

export interface NormalizationSummary {
  /** Счета, валюта которых приведена к основной валюте копии. */
  currencies: number
  /** Сброшен ли lastAccountId, указывавший на несуществующий счёт. */
  lastAccountReset: boolean
}

export interface NormalizedBackup {
  data: BackupData
  summary: NormalizationSummary
}

export function normalizeBackup(data: BackupData): NormalizedBackup {
  const { baseCurrency } = data.settings

  // Приложение однoвалютное: суммы разных валют нельзя складывать как копейки,
  // а общий баланс — это сумма по всем счетам. Курсов нет, поэтому меняется
  // только код валюты, числа остаются прежними — так же ведёт себя смена
  // основной валюты в настройках
  let currencies = 0
  const accounts = data.accounts.map((account) => {
    if (account.currency === baseCurrency) return account
    currencies += 1
    return { ...account, currency: baseCurrency }
  })

  const accountIds = new Set(accounts.map((account) => account.id))
  const lastAccountReset = data.settings.lastAccountId !== null && !accountIds.has(data.settings.lastAccountId)

  return {
    data: {
      ...data,
      accounts,
      settings: lastAccountReset ? { ...data.settings, lastAccountId: null } : data.settings,
    },
    summary: { currencies, lastAccountReset },
  }
}
