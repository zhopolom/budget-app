import { useEffect } from 'react'
import type { ThemePreference } from '../../types/entities'

/** Должны совпадать с --bg в styles/tokens.css. */
const THEME_BACKGROUNDS = { light: '#F4F2F8', dark: '#121019' } as const

/**
 * Копия выбранной темы в localStorage — только чтобы inline-скрипт в index.html
 * применил её до загрузки React (без вспышки светлой темы). Источник истины — IndexedDB.
 */
export const THEME_STORAGE_KEY = 'budget:theme'

export function useApplyTheme(theme: ThemePreference | undefined): void {
  useEffect(() => {
    if (!theme) return

    const root = document.documentElement
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme

    // Две meta theme-color с media — для светлой и тёмной системной темы.
    // При явном выборе обе получают один цвет.
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      const systemScheme = meta.media.includes('dark') ? 'dark' : 'light'
      meta.content = THEME_BACKGROUNDS[theme === 'system' ? systemScheme : theme]
    })

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Приватный режим Safari может запрещать запись — не критично
    }
  }, [theme])
}
