import type { ReactNode } from 'react'
import styles from './Banner.module.css'

interface BannerProps {
  icon: string
  title: string
  text?: string
  tone?: 'neutral' | 'attention'
  /** Кнопки: первая — основная. */
  actions?: ReactNode
}

/**
 * Полоса-уведомление на главной: нашлись потерянные операции, давно не было
 * резервной копии. Не модальное окно — приложение остаётся рабочим, а
 * сообщение не требует немедленной реакции.
 */
export function Banner({ icon, title, text, tone = 'neutral', actions }: BannerProps) {
  return (
    <section className={styles.banner} data-tone={tone} role="status">
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        {text && <p className={styles.text}>{text}</p>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </section>
  )
}
