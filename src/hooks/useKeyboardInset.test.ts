import { describe, expect, it } from 'vitest'
import { isTextEntryTarget, keyboardInsetFrom, type ViewportMetrics } from './useKeyboardInset'

/** iPhone 14: экран 852pt, клавиатура ~336pt. */
const closed: ViewportMetrics = {
  innerHeight: 852,
  viewportHeight: 852,
  offsetTop: 0,
  scale: 1,
  textEntryFocused: false,
}
const open: ViewportMetrics = { ...closed, viewportHeight: 516, textEntryFocused: true }

describe('keyboardInsetFrom', () => {
  it('без клавиатуры даёт ноль', () => {
    expect(keyboardInsetFrom(closed)).toBe(0)
  })

  it('с открытой клавиатурой даёт её высоту', () => {
    expect(keyboardInsetFrom(open)).toBe(336)
  })

  it('учитывает сдвиг visual viewport', () => {
    expect(keyboardInsetFrom({ ...open, offsetTop: 40 })).toBe(296)
  })

  it('без фокуса в поле ввода даёт ноль, даже пока клавиатура ещё уезжает', () => {
    // Тап по «Наличные» снимает фокус: панели должны сразу поехать вниз одним движением
    expect(keyboardInsetFrom({ ...open, textEntryFocused: false })).toBe(0)
  })

  it('игнорирует мелкое сжатие вьюпорта: панели Safari и резиновая прокрутка — не клавиатура', () => {
    expect(keyboardInsetFrom({ ...open, viewportHeight: 852 - 60 })).toBe(0)
    expect(keyboardInsetFrom({ ...open, offsetTop: 300 })).toBe(0)
  })

  it('не даёт отрицательных значений при рассогласовании height и offsetTop', () => {
    // Во время анимации iOS присылает кадры, где вьюпорт «выше» экрана
    expect(keyboardInsetFrom({ ...open, viewportHeight: 852, offsetTop: 120 })).toBe(0)
  })

  it('при pinch-zoom клавиатуру не выдумывает', () => {
    expect(keyboardInsetFrom({ ...open, scale: 1.8 })).toBe(0)
  })

  it('округляет дробную высоту вьюпорта', () => {
    expect(keyboardInsetFrom({ ...open, viewportHeight: 516.4 })).toBe(336)
  })
})

describe('isTextEntryTarget', () => {
  it('поля ввода ждут клавиатуру', () => {
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'SELECT' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('кнопки и переключатели — нет', () => {
    expect(isTextEntryTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false)
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'submit' })).toBe(false)
    expect(isTextEntryTarget({ tagName: 'DIV' })).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
  })
})
