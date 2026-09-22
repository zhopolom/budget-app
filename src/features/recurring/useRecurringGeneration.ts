import { useEffect, useRef } from 'react'
import { useToast } from '../../components/Toast/toastContext'
import type { IsoDate } from '../../types/entities'
import { pluralRu } from '../../utils/plural'
import { recurringRepository } from './repository'

/**
 * Создаёт просроченные регулярные операции при запуске приложения.
 *
 * Фоновых задач у local-first приложения нет, поэтому единственный момент —
 * открытие. Повторный запуск ничего не задваивает: generateDue идемпотентна,
 * а ref не даёт эффекту сработать дважды за один и тот же день (в том числе
 * от повторного вызова эффектов в StrictMode).
 *
 * Дата приходит из useToday, поэтому после полуночи и при возврате в
 * приложение проверка повторяется.
 */
export function useRecurringGeneration(today: IsoDate): void {
  const toast = useToast()
  const lastRun = useRef<IsoDate | null>(null)

  useEffect(() => {
    if (lastRun.current === today) return
    lastRun.current = today

    let cancelled = false
    void recurringRepository
      .generateDue(today)
      .then((result) => {
        if (cancelled) return
        if (result.created > 0) {
          toast.show(
            `Добавлено ${result.created} ${pluralRu(result.created, ['регулярная операция', 'регулярные операции', 'регулярных операций'])}`,
          )
        }
        if (result.pending > 0) {
          toast.show(
            `${result.pending} ${pluralRu(result.pending, ['операция ждёт подтверждения', 'операции ждут подтверждения', 'операций ждут подтверждения'])}`,
          )
        }
      })
      .catch(() => {
        // Не блокируем запуск: расписания досоздадутся при следующем открытии
        lastRun.current = null
      })

    return () => {
      cancelled = true
    }
  }, [today, toast])
}
