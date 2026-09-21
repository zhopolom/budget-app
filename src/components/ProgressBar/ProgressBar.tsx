import styles from './ProgressBar.module.css'

interface ProgressBarProps {
  /** 0…1, значения больше 1 обрезаются визуально. */
  value: number
  tone?: 'normal' | 'warning' | 'danger'
  label: string
}

export function ProgressBar({ value, tone = 'normal', label }: ProgressBarProps) {
  const clamped = Math.min(Math.max(value, 0), 1)
  const percent = Math.round(clamped * 100)

  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className={styles.fill} data-tone={tone} style={{ width: `${percent}%` }} />
    </div>
  )
}
