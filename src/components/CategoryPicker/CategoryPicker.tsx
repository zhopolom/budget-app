import type { Category, Id } from '../../types/entities'
import styles from './CategoryPicker.module.css'

interface CategoryPickerProps {
  categories: readonly Category[]
  value: Id | null
  onChange: (id: Id) => void
  error?: string
}

export function CategoryPicker({ categories, value, onChange, error }: CategoryPickerProps) {
  return (
    <div className={styles.picker}>
      <div className={styles.grid} role="radiogroup" aria-label="Категория" aria-invalid={error ? true : undefined}>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            role="radio"
            aria-checked={category.id === value}
            className={styles.option}
            onClick={() => onChange(category.id)}
          >
            <span className={styles.icon} aria-hidden="true">
              {category.icon}
            </span>
            <span className={styles.name}>{category.name}</span>
          </button>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
