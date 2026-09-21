import type { CurrencyCode, IsoDate, MinorUnits } from '../../types/entities'
import { isWeekend, monthDays, weekdayIndex, WEEKDAY_LABELS, type YearMonth } from '../../utils/dates'
import { Money } from '../../utils/money'
import styles from './MonthGrid.module.css'

interface MonthGridProps {
  month: YearMonth
  /** Расходы по дням; дни без трат в карте отсутствуют. */
  expenses: ReadonlyMap<IsoDate, MinorUnits>
  /** Дни, в которых есть хоть какая-то операция (в том числе доход или перевод). */
  active: ReadonlySet<IsoDate>
  selected: IsoDate | null
  today: IsoDate
  currency: CurrencyCode
  onSelect: (date: IsoDate) => void
}

/**
 * Насыщенность ячейки по доле от самого дорогого дня месяца: четыре ступени
 * вместо плавной шкалы — так разница читается, а сетка не рябит.
 */
function intensityOf(amount: MinorUnits, max: MinorUnits): 1 | 2 | 3 | 4 {
  if (max <= 0) return 1
  const ratio = amount / max
  if (ratio > 0.75) return 4
  if (ratio > 0.5) return 3
  if (ratio > 0.25) return 2
  return 1
}

export function MonthGrid({ month, expenses, active, selected, today, currency, onSelect }: MonthGridProps) {
  const days = monthDays(month)
  // Пустые ячейки до первого числа, чтобы месяц встал на свои дни недели
  const leading = weekdayIndex(days[0])
  const max = Math.max(0, ...expenses.values())

  return (
    <div className={styles.calendar}>
      <div className={styles.weekdays} aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className={styles.weekday}>
            {label}
          </span>
        ))}
      </div>

      <div className={styles.grid} role="grid" aria-label="Расходы по дням">
        {Array.from({ length: leading }, (_, index) => (
          <span key={`pad-${index}`} className={styles.pad} />
        ))}

        {days.map((date) => {
          const amount = expenses.get(date) ?? 0
          const dayNumber = Number(date.slice(8))

          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              className={styles.day}
              data-today={date === today || undefined}
              data-selected={date === selected || undefined}
              data-weekend={isWeekend(date) || undefined}
              data-intensity={amount > 0 ? intensityOf(amount, max) : undefined}
              data-empty={!active.has(date) || undefined}
              aria-label={`${dayNumber}: ${amount > 0 ? `расходы ${Money.format(amount, currency)}` : 'расходов нет'}`}
              aria-pressed={date === selected}
              onClick={() => onSelect(date)}
            >
              <span className={styles.number}>{dayNumber}</span>
              {amount > 0 ? (
                <span className={styles.amount}>{Money.formatCompact(amount)}</span>
              ) : (
                <span className={styles.dot} data-visible={active.has(date) || undefined} aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
