/**
 * Ступени размытия для диагностики. Blur — самая дорогая часть Liquid Glass,
 * и проверить это можно только на устройстве: снизить ступень, посмотреть
 * на счётчик кадров.
 */

export type GlassBlurStep = 'normal' | 'low' | 'off'

export const GLASS_BLUR_OPTIONS = [
  { value: 'normal', label: 'Обычное' },
  { value: 'low', label: 'Слабое' },
  { value: 'off', label: 'Без' },
] as const satisfies readonly { value: GlassBlurStep; label: string }[]

/** Ступень живёт в атрибуте на <html>: CSS переопределяет переменные размытия. */
export function applyGlassBlur(step: GlassBlurStep): void {
  const root = document.documentElement
  if (step === 'normal') delete root.dataset.glassBlur
  else root.dataset.glassBlur = step
}

export function currentGlassBlur(): GlassBlurStep {
  const value = document.documentElement.dataset.glassBlur
  return value === 'low' || value === 'off' ? value : 'normal'
}
