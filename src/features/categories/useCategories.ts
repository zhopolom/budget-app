import { useLiveQuery } from 'dexie-react-hooks'
import type { Category } from '../../types/entities'
import { categoriesRepository } from './repository'

export function useCategories(): Category[] | undefined {
  return useLiveQuery(() => categoriesRepository.listAll(), [])
}
