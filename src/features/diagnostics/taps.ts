/**
 * Секретное нажатие по строке с версией. Диагностика нужна на живом
 * устройстве, поэтому она есть и в production-сборке — но на глаза не лезет.
 */

export const SECRET_TAP_COUNT = 7

/** Пауза, после которой счёт нажатий начинается заново. */
export const TAP_WINDOW_MS = 1_500

export interface TapState {
  count: number
  lastAt: number
}

export const NO_TAPS: TapState = { count: 0, lastAt: 0 }

export function registerTap(state: TapState, now: number): TapState {
  const continues = now - state.lastAt <= TAP_WINDOW_MS
  return { count: continues ? state.count + 1 : 1, lastAt: now }
}

export function isUnlocked(state: TapState): boolean {
  return state.count >= SECRET_TAP_COUNT
}

/**
 * Подсказка на последних нажатиях: «Ещё 3». Раньше молчим, иначе случайный
 * двойной тап по версии начнёт мигать непонятным счётчиком.
 */
export function tapHint(state: TapState): string | null {
  const left = SECRET_TAP_COUNT - state.count
  if (left <= 0 || left > 3) return null
  return `Ещё ${left}`
}
