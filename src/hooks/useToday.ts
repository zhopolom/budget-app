import { useEffect, useState } from 'react'
import type { IsoDate } from '../types/entities'
import { toIsoDate } from '../utils/dates'

/**
 * Текущая дата, которая обновляется в полночь и при возврате в приложение.
 * iOS держит PWA в фоне днями — без этого «Сегодня» и текущий месяц устаревают.
 */
export function useToday(): IsoDate {
  const [today, setToday] = useState(() => toIsoDate(new Date()))

  useEffect(() => {
    const refresh = () => setToday(toIsoDate(new Date()))
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const timer = window.setTimeout(refresh, nextMidnight.getTime() - now.getTime() + 1000)

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [today])

  return today
}
