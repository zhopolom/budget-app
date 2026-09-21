import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import styles from './ToastProvider.module.css'
import { ToastContext, type ToastApi } from './toastContext'

interface ToastState {
  id: number
  message: string
  tone: 'default' | 'error'
}

const DURATION_MS = 2400

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  const api = useMemo<ToastApi>(
    () => ({
      show(message, options) {
        window.clearTimeout(timerRef.current)
        setToast({ id: Date.now(), message, tone: options?.tone ?? 'default' })
        timerRef.current = window.setTimeout(() => setToast(null), DURATION_MS)
      },
    }),
    [],
  )

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  return (
    <ToastContext value={api}>
      {children}
      {/* Живой регион всегда в DOM — так скринридеры надёжно зачитывают новые сообщения */}
      <div className={styles.region} role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className={styles.toast} data-tone={toast.tone}>
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext>
  )
}
