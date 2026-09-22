import { recordDiagnostic } from './journal'

/**
 * Сбои — в журнал диагностики без пользовательских данных (ТЗ §80): имя
 * ошибки и её сообщение, без стека и без того, что было на экране.
 * Сообщения ошибок в приложении — служебные («Счёт не найден»), сумм и
 * заметок в них нет.
 */

const MAX_MESSAGE = 120

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE)
    return message ? `${error.name}: ${message}` : error.name
  }
  return typeof error === 'string' ? error.slice(0, MAX_MESSAGE) : 'Неизвестная ошибка'
}

export function recordCrash(scope: string, error: unknown): void {
  recordDiagnostic(`${scope}: ${describeError(error)}`)
  // В разработке — полный стек в консоль; в production консоль молчит
  if (import.meta.env.DEV) console.error(scope, error)
}

let installed = false

/** Необработанные ошибки и промисы — туда же. Ставится один раз при старте. */
export function installGlobalErrorJournal(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (event) => recordCrash('Ошибка', event.error ?? event.message))
  window.addEventListener('unhandledrejection', (event) => recordCrash('Необработанный промис', event.reason))
}
