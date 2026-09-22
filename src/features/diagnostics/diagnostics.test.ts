import { describe, expect, it } from 'vitest'
import { fpsFrom } from './fps'
import { isUnlocked, NO_TAPS, registerTap, SECRET_TAP_COUNT, TAP_WINDOW_MS, tapHint } from './taps'

const tapTimes = (times: readonly number[]) => times.reduce(registerTap, NO_TAPS)

describe('секретное нажатие', () => {
  it('открывает диагностику ровно на седьмом нажатии подряд', () => {
    const times = Array.from({ length: SECRET_TAP_COUNT }, (_, index) => index * 200)

    expect(isUnlocked(tapTimes(times.slice(0, SECRET_TAP_COUNT - 1)))).toBe(false)
    expect(isUnlocked(tapTimes(times))).toBe(true)
  })

  it('пауза начинает счёт заново', () => {
    const state = tapTimes([0, 200, 400])
    const afterPause = registerTap(state, 400 + TAP_WINDOW_MS + 1)

    expect(afterPause.count).toBe(1)
  })

  it('на границе окна счёт продолжается', () => {
    const state = registerTap({ count: 3, lastAt: 0 }, TAP_WINDOW_MS)
    expect(state.count).toBe(4)
  })

  it('подсказку показывает только на последних трёх нажатиях', () => {
    expect(tapHint({ count: 3, lastAt: 0 })).toBe(null)
    expect(tapHint({ count: 4, lastAt: 0 })).toBe('Ещё 3')
    expect(tapHint({ count: 6, lastAt: 0 })).toBe('Ещё 1')
    expect(tapHint({ count: SECRET_TAP_COUNT, lastAt: 0 })).toBe(null)
  })
})

describe('fpsFrom', () => {
  it('переводит кадры за промежуток в кадры в секунду', () => {
    expect(fpsFrom(30, 500)).toBe(60)
    expect(fpsFrom(15, 500)).toBe(30)
  })

  it('нулевой промежуток не делит на ноль', () => {
    expect(fpsFrom(10, 0)).toBe(0)
  })
})
