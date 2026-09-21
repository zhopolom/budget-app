let locks = 0

/** Блокирует прокрутку страницы под модальным окном. Поддерживает вложенные окна. */
export function lockScroll(): () => void {
  if (locks === 0) document.documentElement.classList.add('scroll-locked')
  locks += 1

  let released = false
  return () => {
    if (released) return
    released = true
    locks -= 1
    if (locks === 0) document.documentElement.classList.remove('scroll-locked')
  }
}
