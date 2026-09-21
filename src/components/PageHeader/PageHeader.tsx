import type { ReactNode } from 'react'
import { goBack } from '../../app/navigation'
import { Icon } from '../Icon/Icon'
import styles from './PageHeader.module.css'

interface PageHeaderProps {
  title: string
  action?: ReactNode
  /** Показывает кнопку «Назад»; значение — куда идти, если истории нет. */
  backTo?: string
}

export function PageHeader({ title, action, backTo }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      {backTo && (
        <button type="button" className={styles.back} onClick={() => goBack(backTo)} aria-label="Назад">
          <Icon name="chevronLeft" size={26} />
        </button>
      )}
      <h1 className={styles.title}>{title}</h1>
      {action && <div className={styles.action}>{action}</div>}
    </header>
  )
}
