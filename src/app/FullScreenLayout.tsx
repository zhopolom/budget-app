import type { ReactNode } from 'react'
import { Icon } from '../components/Icon/Icon'
import styles from './FullScreenLayout.module.css'

interface FullScreenLayoutProps {
  title: string
  onClose: () => void
  children: ReactNode
}

/** Экран поверх вкладок (без нижней навигации) с кнопкой закрытия. */
export function FullScreenLayout({ title, onClose, children }: FullScreenLayoutProps) {
  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Закрыть">
          <Icon name="close" />
        </button>
      </header>
      {children}
    </div>
  )
}
