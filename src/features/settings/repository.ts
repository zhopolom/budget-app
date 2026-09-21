import { db } from '../../db/database'
import type { AppSettings, CurrencyCode } from '../../types/entities'
import { createDefaultSettings, SETTINGS_ID } from './defaults'

export const settingsRepository = {
  /** Всегда возвращает полный объект: недостающие поля берутся из значений по умолчанию. */
  async get(): Promise<AppSettings> {
    const stored = await db.settings.get(SETTINGS_ID)
    return { ...createDefaultSettings(), ...stored }
  },

  async update(patch: Partial<Omit<AppSettings, 'id'>>): Promise<void> {
    const current = await settingsRepository.get()
    await db.settings.put({ ...current, ...patch, id: SETTINGS_ID })
  },

  /**
   * Меняет валюту приложения вместе со счетами, которые были в прежней валюте.
   *
   * Суммы не пересчитываются: курса у приложения нет и быть не должно —
   * меняется только символ. Счета обновляются в той же транзакции, иначе
   * переводы между ними начнут падать на проверке «счета в разных валютах».
   *
   * Возвращает число обновлённых счетов.
   */
  async setBaseCurrency(currency: CurrencyCode): Promise<number> {
    return db.transaction('rw', db.settings, db.accounts, async () => {
      const current = await settingsRepository.get()
      if (current.baseCurrency === currency) return 0

      const now = Date.now()
      const updated = await db.accounts
        .filter((account) => account.currency === current.baseCurrency)
        .modify({ currency, updatedAt: now })

      await db.settings.put({ ...current, baseCurrency: currency, id: SETTINGS_ID })
      return updated
    })
  },
}
