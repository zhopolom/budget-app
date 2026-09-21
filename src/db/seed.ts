import type { Transaction as DexieTransaction } from 'dexie'
import { createDefaultAccounts } from '../features/accounts/defaults'
import { createDefaultCategories } from '../features/categories/defaults'
import { createDefaultSettings } from '../features/settings/defaults'

/** Выполняется один раз — когда база создаётся впервые. */
export function seedDefaults(tx: DexieTransaction): Promise<unknown> {
  const now = Date.now()
  const settings = createDefaultSettings()

  return Promise.all([
    tx.table('settings').add(settings),
    tx.table('accounts').bulkAdd(createDefaultAccounts(now, settings.baseCurrency)),
    tx.table('categories').bulkAdd(createDefaultCategories(now)),
  ])
}
