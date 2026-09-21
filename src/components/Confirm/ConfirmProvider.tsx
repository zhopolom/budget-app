import { useCallback, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from '../Button/Button'
import { Dialog } from '../Dialog/Dialog'
import styles from './ConfirmProvider.module.css'
import { ConfirmContext, type ConfirmOptions } from './confirmContext'

/** Замена window.confirm(): одно диалоговое окно на всё приложение, вызов через useConfirm(). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<((result: boolean) => void) | null>(null)
  const titleId = useId()

  const confirm = useCallback((next: ConfirmOptions) => {
    resolveRef.current?.(false)
    setOptions(next)
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  const finish = (result: boolean) => {
    resolveRef.current?.(result)
    resolveRef.current = null
    setOptions(null)
  }

  return (
    <ConfirmContext value={confirm}>
      {children}
      <Dialog open={options !== null} onClose={() => finish(false)} variant="center" labelledBy={titleId} role="alertdialog">
        {options && (
          <>
            <h2 id={titleId} className={styles.title}>
              {options.title}
            </h2>
            {options.message && <p className={styles.message}>{options.message}</p>}
            {/* «Отмена» первой в DOM — на неё попадает фокус, случайный Enter ничего не удалит */}
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => finish(false)}>
                {options.cancelLabel ?? 'Отмена'}
              </Button>
              <Button variant={options.tone === 'danger' ? 'destructive' : 'primary'} onClick={() => finish(true)}>
                {options.confirmLabel}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </ConfirmContext>
  )
}
