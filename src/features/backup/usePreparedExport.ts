import { useLiveQuery } from 'dexie-react-hooks'
import { accountsRepository } from '../accounts/repository'
import { categoriesRepository } from '../categories/repository'
import { settingsRepository } from '../settings/repository'
import { transactionsRepository } from '../transactions/repository'
import { toTransactionViews } from '../transactions/views'
import { toCsv, UTF8_BOM } from './csv'
import type { PreparedBackup } from './export'
import { createBackup, serializeBackup } from './repository'

/**
 * Файлы экспорта собираются заранее, ещё до нажатия кнопки.
 *
 * Причина не в скорости: navigator.share на iOS принимается только пока жив
 * жест пользователя, а сборка файла — это чтение IndexedDB, то есть await,
 * после которого жест считается законченным и системная шторка не открывается.
 * Поэтому к моменту нажатия содержимое уже лежит готовой строкой.
 *
 * Живой запрос пересобирает файл при изменении данных. Если объём когда-нибудь
 * станет заметным, сюда добавится debounce — сейчас это доли секунды.
 */
export function usePreparedBackup(appVersion: string): PreparedBackup | undefined {
  return useLiveQuery(async () => {
    const preparedAt = new Date()
    const backup = await createBackup(preparedAt, appVersion)
    return { content: serializeBackup(backup), preparedAt }
  }, [appVersion])
}

export interface PreparedCsv {
  content: string
  preparedAt: Date
  transactions: number
}

/** То же для выгрузки в CSV: она уходит тем же путём, через «Поделиться». */
export function usePreparedCsv(): PreparedCsv | undefined {
  return useLiveQuery(async () => {
    const preparedAt = new Date()
    const [transactions, categories, accounts, settings] = await Promise.all([
      transactionsRepository.listAll(),
      categoriesRepository.listAll(),
      accountsRepository.listAll(),
      settingsRepository.get(),
    ])

    // По возрастанию даты: так таблицу читают как журнал операций
    const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    const content = UTF8_BOM + toCsv(toTransactionViews(sorted, categories, accounts), settings.baseCurrency)

    return { content, preparedAt, transactions: transactions.length }
  }, [])
}
