import { useEffect } from 'react'

/**
 * Ниже этого порога сжатие вьюпорта — не клавиатура, а панели Safari,
 * резиновая прокрутка или подсказка автозаполнения.
 */
const MIN_KEYBOARD_HEIGHT = 100

/** Типы input, которые не открывают экранную клавиатуру. */
const SILENT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/** Минимум, который нужен от сфокусированного элемента, чтобы понять, ждёт ли он ввода. */
interface FocusTarget {
  tagName?: string
  type?: string
  isContentEditable?: boolean
}

/** Клавиатуры не может быть, если фокус не в поле ввода. */
export function isTextEntryTarget(element: FocusTarget | null | undefined): boolean {
  if (!element) return false
  if (element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') return true
  if (element.tagName === 'INPUT') return !SILENT_INPUT_TYPES.has(element.type ?? 'text')
  return element.isContentEditable === true
}

export interface ViewportMetrics {
  /** Высота layout viewport: на iOS клавиатура её не меняет. */
  innerHeight: number
  /** Высота visual viewport: её клавиатура как раз и урезает. */
  viewportHeight: number
  /** Насколько visual viewport сдвинут вниз относительно layout viewport. */
  offsetTop: number
  scale: number
  /** Есть ли фокус в поле ввода. */
  textEntryFocused: boolean
}

/**
 * Высота, на которую нужно поднять нижние панели, чтобы они оказались над клавиатурой.
 *
 * Чистая функция: вся защита от дребезга живёт здесь и покрыта тестами. iOS во время
 * анимации клавиатуры шлёт десятки событий, в которых height и offsetTop рассогласованы,
 * поэтому промежуточные значения отбрасываем, а не переносим ими шторку по экрану.
 */
export function keyboardInsetFrom({
  innerHeight,
  viewportHeight,
  offsetTop,
  scale,
  textEntryFocused,
}: ViewportMetrics): number {
  // При pinch-zoom visual viewport тоже меняется — это не клавиатура
  if (scale > 1.01) return 0
  // Фокус ушёл из поля — клавиатура закрывается, панели возвращаются к нижнему краю
  if (!textEntryFocused) return 0

  const inset = innerHeight - viewportHeight - offsetTop
  return inset >= MIN_KEYBOARD_HEIGHT ? Math.round(inset) : 0
}

/**
 * Пишет высоту экранной клавиатуры в CSS-переменную --keyboard-inset.
 * В iOS fixed-элементы остаются под клавиатурой; с этой переменной кнопка
 * «Добавить», тосты и нижние шторки поднимаются над ней.
 *
 * Значение обновляется не чаще раза в кадр и только когда действительно меняется:
 * от него зависит положение шторки, а каждая лишняя запись — это её рывок.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const root = document.documentElement
    let frame = 0
    let applied: number | null = null

    const apply = () => {
      frame = 0
      const inset = keyboardInsetFrom({
        innerHeight: window.innerHeight,
        viewportHeight: viewport.height,
        offsetTop: viewport.offsetTop,
        scale: viewport.scale,
        textEntryFocused: isTextEntryTarget(document.activeElement),
      })
      if (inset === applied) return
      applied = inset
      root.style.setProperty('--keyboard-inset', `${inset}px`)
    }

    // За одну анимацию клавиатуры iOS присылает пачку resize/scroll — схлопываем их в один кадр
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(apply)
    }

    // Фокус меняется раньше, чем вьюпорт: по нему панели трогаются с места сразу и одним движением
    apply()
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    window.addEventListener('focusin', schedule)
    window.addEventListener('focusout', schedule)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      window.removeEventListener('focusin', schedule)
      window.removeEventListener('focusout', schedule)
      root.style.removeProperty('--keyboard-inset')
    }
  }, [])
}
