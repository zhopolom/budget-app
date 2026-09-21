import { db } from '../../db/database'
import type { AppSettings } from '../../types/entities'
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
}
