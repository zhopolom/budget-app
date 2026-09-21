import { useId } from 'react'
import { Icon } from '../Icon/Icon'
import styles from './SearchField.module.css'

interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label: string
}

export function SearchField({ value, onChange, placeholder, label }: SearchFieldProps) {
  const id = useId()

  return (
    <div className={styles.field}>
      <span className={styles.icon} aria-hidden="true">
        🔍
      </span>
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value !== '' && (
        <button type="button" className={styles.clear} onClick={() => onChange('')} aria-label="Очистить поиск">
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  )
}
