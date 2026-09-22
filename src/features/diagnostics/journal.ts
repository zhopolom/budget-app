import { useSyncExternalStore } from 'react'

/**
 * Короткий журнал сбоев для панели диагностики.
 *
 * Нужен для того, что иначе не поймать: «Поделиться» не открылось на телефоне,
 * а отладчика под рукой нет. Живёт только в памяти вкладки, никуда не
 * сохраняется и никуда не отправляется — как и всё остальное в приложении.
 */

const MAX_ENTRIES = 20

const entries: string[] = []
const listeners = new Set<() => void>()

/** Пустой массив-константа: useSyncExternalStore сравнивает снимки по ссылке. */
let snapshot: readonly string[] = entries.slice()

export function recordDiagnostic(message: string): void {
  entries.unshift(message)
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES

  snapshot = entries.slice()
  for (const listener of listeners) listener()
}

export function useDiagnosticJournal(): readonly string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot,
    () => snapshot,
  )
}

/** Только для тестов: журнал переживает перемонтирование панели. */
export function clearDiagnosticJournal(): void {
  entries.length = 0
  snapshot = entries.slice()
  for (const listener of listeners) listener()
}
