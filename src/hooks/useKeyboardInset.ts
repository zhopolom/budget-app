import { useEffect } from 'react'

/**
 * Пишет высоту экранной клавиатуры в CSS-переменную --keyboard-inset.
 * В iOS fixed-элементы остаются под клавиатурой; с этой переменной кнопка
 * «Добавить» и нижние шторки поднимаются над ней.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const root = document.documentElement
    const update = () => {
      // При pinch-zoom visualViewport тоже меняется — это не клавиатура
      const inset = viewport.scale > 1.01 ? 0 : window.innerHeight - viewport.height - viewport.offsetTop
      root.style.setProperty('--keyboard-inset', `${Math.max(0, Math.round(inset))}px`)
    }

    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])
}
