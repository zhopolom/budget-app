import { useEffect, useState } from 'react'

/** Как часто обновляется показание счётчика кадров. */
const SAMPLE_MS = 500

export function fpsFrom(frames: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0
  return Math.round((frames * 1000) / elapsedMs)
}

/**
 * Кадры в секунду. Сам по себе rAF-цикл стоит недорого, но работает только
 * пока открыта диагностика: фоновый счётчик кадров — это и есть потеря кадров.
 */
export function useFps(active: boolean): number {
  const [fps, setFps] = useState(0)

  useEffect(() => {
    if (!active) return

    let frame = 0
    let frames = 0
    let since = performance.now()

    const tick = (now: number) => {
      frames += 1
      const elapsed = now - since
      if (elapsed >= SAMPLE_MS) {
        setFps(fpsFrom(frames, elapsed))
        frames = 0
        since = now
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active])

  return fps
}
