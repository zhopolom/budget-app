import type { SelectedMonth } from '../../app/selectedMonth'
import { formatMonthTitle, shiftMonth } from '../../utils/dates'
import { Icon } from '../Icon/Icon'
import styles from './MonthSelector.module.css'

interface MonthSelectorProps {
  selection: SelectedMonth
  /** Заголовок экрана слева от переключателя (Главная показывает месяц сама). */
  title?: string
}

/**
 * Единый переключатель месяца для Главной, Операций, Календаря и Статистики.
 * Выбор общий: перелистнул здесь — соседние экраны откроются на том же месяце.
 */
export function MonthSelector({ selection, title }: MonthSelectorProps) {
  const { month, isCurrent, select, reset } = selection
  const label = formatMonthTitle(month)

  return (
    <div className={styles.bar} data-standalone={title ? undefined : ''}>
      {title && <h1 className={styles.title}>{title}</h1>}

      <div className={styles.switcher} role="group" aria-label="Выбор месяца">
        <button
          type="button"
          className={styles.arrow}
          onClick={() => select(shiftMonth(month, -1))}
          aria-label="Предыдущий месяц"
        >
          <Icon name="chevronLeft" size={20} />
        </button>

        <span className={styles.month} aria-live="polite">
          {label}
        </span>

        <button
          type="button"
          className={styles.arrow}
          onClick={() => select(shiftMonth(month, 1))}
          aria-label="Следующий месяц"
        >
          <Icon name="chevronRight" size={20} />
        </button>
      </div>

      {/* Возврат к текущему месяцу: иначе из далёкого прошлого листать долго */}
      {!isCurrent && (
        <button type="button" className={styles.today} onClick={reset} aria-label="Вернуться к текущему месяцу">
          Сегодня
        </button>
      )}
    </div>
  )
}
