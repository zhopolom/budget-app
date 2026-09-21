import { useSyncExternalStore } from 'react'

/**
 * Минимальная навигация на History API.
 * Шесть-восемь плоских экранов не оправдывают ~30 КБ gzip от react-router.
 * Если понадобятся вложенные маршруты или параметры в пути — меняется только этот файл и router.tsx.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const listeners = new Set<() => void>()

interface HistoryState {
  /** Сколько переходов назад можно сделать внутри приложения. */
  depth: number
}

function currentDepth(): number {
  return (window.history.state as HistoryState | null)?.depth ?? 0
}

function notify() {
  listeners.forEach((listener) => listener())
}

window.addEventListener('popstate', notify)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Путь внутри приложения без base и без завершающего слэша: '/', '/settings'. */
function getPath(): string {
  const path = window.location.pathname.slice(BASE.length) || '/'
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

function getSearch(): string {
  return window.location.search
}

export function toHref(path: string): string {
  return `${BASE}${path}`
}

/** path может содержать query: '/edit?id=…'. */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (path === getPath() + getSearch()) return

  const depth = currentDepth()
  if (options.replace) window.history.replaceState({ depth } satisfies HistoryState, '', toHref(path))
  else window.history.pushState({ depth: depth + 1 } satisfies HistoryState, '', toHref(path))

  window.scrollTo(0, 0)
  notify()
}

/** Назад по истории, а если приложение открыто сразу на этом экране — на fallback. */
export function goBack(fallback = '/'): void {
  if (currentDepth() > 0) window.history.back()
  else navigate(fallback, { replace: true })
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, getPath)
}

export function useSearchParam(name: string): string | null {
  const search = useSyncExternalStore(subscribe, getSearch)
  return new URLSearchParams(search).get(name)
}
