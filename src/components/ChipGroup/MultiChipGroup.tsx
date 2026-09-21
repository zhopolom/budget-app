import { keepFocus } from '../../utils/keepFocus'
import type { Chip } from './ChipGroup'
import styles from './ChipGroup.module.css'

interface MultiChipGroupProps<T extends string> {
  chips: readonly Chip<T>[]
  /** Пустой массив — ничего не выбрано, то есть «все». */
  values: readonly T[]
  onToggle: (value: T) => void
  label: string
  layout?: 'wrap' | 'scroll'
}

/** Набор «таблеток» с множественным выбором: фильтры по типу, счёту, категории. */
export function MultiChipGroup<T extends string>({
  chips,
  values,
  onToggle,
  label,
  layout = 'wrap',
}: MultiChipGroupProps<T>) {
  return (
    <div className={styles.group} data-layout={layout} role="group" aria-label={label}>
      {chips.map((chip) => {
        const checked = values.includes(chip.value)
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={checked}
            className={styles.chip}
            onMouseDown={keepFocus}
            onClick={() => onToggle(chip.value)}
          >
            {chip.icon && (
              <span className={styles.icon} aria-hidden="true">
                {chip.icon}
              </span>
            )}
            {chip.label}
          </button>
        )
      })}
    </div>
  )
}
