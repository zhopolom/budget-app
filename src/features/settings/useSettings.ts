import { useLiveQuery } from 'dexie-react-hooks'
import type { AppSettings } from '../../types/entities'
import { settingsRepository } from './repository'

/** undefined — пока идёт первое чтение из IndexedDB. */
export function useSettings(): AppSettings | undefined {
  return useLiveQuery(() => settingsRepository.get(), [])
}
