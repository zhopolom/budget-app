/**
 * iOS открывает клавиатуру, только если focus() вызван прямо в обработчике жеста.
 * Экран добавления монтируется чуть позже, поэтому по тапу на «+» фокусируем
 * невидимое поле-заглушку: клавиатура открывается сразу, а когда появляется
 * настоящее поле суммы, фокус переходит на него и клавиатура остаётся.
 */

let primer: HTMLInputElement | null = null

export function primeKeyboard(): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return

  releaseKeyboardPrimer()
  const input = document.createElement('input')
  input.type = 'text'
  input.inputMode = 'decimal'
  input.tabIndex = -1
  input.setAttribute('aria-hidden', 'true')
  Object.assign(input.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    opacity: '0',
    fontSize: '16px',
    pointerEvents: 'none',
  })
  document.body.appendChild(input)
  input.focus()
  primer = input

  // Страховка: если поле суммы так и не появилось
  window.setTimeout(releaseKeyboardPrimer, 1500)
}

export function releaseKeyboardPrimer(): void {
  primer?.remove()
  primer = null
}
