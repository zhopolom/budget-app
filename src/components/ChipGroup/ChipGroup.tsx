import { keepFocus } from '../../utils/keepFocus'
import styles from './ChipGroup.module.css'

export interface Chip<T extends string> {
  value: T
  label: string
  icon?: string
}

interface ChipGroupProps<T extends string> {
  chips: readonly Chip<T>[]
  value: T | null
  onChange: (value: T) => void
  label: string
  /** 'wrap' — в несколько строк, 'scroll' — одна строка с горизонтальной прокруткой. */
  layout?: 'wrap' | 'scroll'
}

/** Выбор одного значения из набора «таблеток». */
export function ChipGroup<T extends string>({ chips, value, onChange, label, layout = 'wrap' }: ChipGroupProps<T>) {
  return (
    <div className={styles.group} data-layout={layout} role="radiogroup" aria-label={label}>
      {chips.map((chip) => (
        <button
          key={chip.value}
          type="button"
          role="radio"
          aria-checked={chip.value === value}
          className={styles.chip}
          onMouseDown={keepFocus}
          onClick={() => onChange(chip.value)}
        >
          {chip.icon && (
            <span className={styles.icon} aria-hidden="true">
              {chip.icon}
            </span>
          )}
          {chip.label}
        </button>
      ))}
    </div>
  )
}
