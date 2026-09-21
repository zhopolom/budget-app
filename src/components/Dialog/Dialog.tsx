import { useEffect, useRef, type ReactNode } from 'react'
import styles from './Dialog.module.css'
import { lockScroll } from './scrollLock'

interface DialogProps {
  open: boolean
  onClose: () => void
  variant: 'sheet' | 'center'
  labelledBy: string
  role?: 'dialog' | 'alertdialog'
  children: ReactNode
}

/**
 * Модальное окно на нативном <dialog>: фокус внутри окна, Esc и top layer —
 * силами браузера. Содержимое монтируется только пока окно открыто,
 * поэтому формы внутри каждый раз стартуют с чистым состоянием.
 */
export function Dialog({ open, onClose, variant, labelledBy, role = 'dialog', children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !open) return

    if (!dialog.open) dialog.showModal()
    const unlock = lockScroll()

    return () => {
      unlock()
      if (dialog.open) dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles[variant]}`}
      aria-labelledby={labelledBy}
      role={role}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // Тап по затемнённому фону вокруг панели
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {open && (
        <div className={`${styles.panel} glass`} data-glass="prominent">
          {children}
        </div>
      )}
    </dialog>
  )
}
