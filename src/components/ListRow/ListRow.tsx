import type { ReactNode } from 'react'
import { Icon } from '../Icon/Icon'
import styles from './ListRow.module.css'

interface ListRowProps {
  icon?: string
  title: string
  subtitle?: string
  /** Текст или сумма справа. */
  value?: ReactNode
  onClick?: () => void
  /** Показывать шеврон — строка ведёт на другой экран. */
  chevron?: boolean
}

/** Строка списка в карточке. С onClick — кнопка, без — просто строка. */
export function ListRow({ icon, title, subtitle, value, onClick, chevron = false }: ListRowProps) {
  const content = (
    <>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles.main}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </span>
      {value !== undefined && <span className={styles.value}>{value}</span>}
      {chevron && (
        <span className={styles.chevron} aria-hidden="true">
          <Icon name="chevronRight" size={18} />
        </span>
      )}
    </>
  )

  return onClick ? (
    <button type="button" className={`${styles.row} ${styles.interactive}`} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={styles.row}>{content}</div>
  )
}

/** Карточка-список: разделители между строками рисует сама. */
export function ListCard({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className={styles.card} aria-label={label}>
      {children}
    </ul>
  )
}

export function ListItem({ children }: { children: ReactNode }) {
  return <li className={styles.item}>{children}</li>
}
