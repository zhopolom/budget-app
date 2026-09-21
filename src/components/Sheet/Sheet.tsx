import { useId, type ReactNode } from 'react'
import { Dialog } from '../Dialog/Dialog'
import { Icon } from '../Icon/Icon'
import styles from './Sheet.module.css'

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/** Нижняя шторка с заголовком и кнопкой закрытия. */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const titleId = useId()

  return (
    <Dialog open={open} onClose={onClose} variant="sheet" labelledBy={titleId}>
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Закрыть">
          <Icon name="close" size={20} />
        </button>
      </header>
      {children}
    </Dialog>
  )
}
