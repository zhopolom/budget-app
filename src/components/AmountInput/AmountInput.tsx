import { useLayoutEffect, useRef } from 'react'
import type { CurrencyCode, TransactionType } from '../../types/entities'
import { releaseKeyboardPrimer } from '../../utils/keyboardPrimer'
import { Money } from '../../utils/money'
import styles from './AmountInput.module.css'

interface AmountInputProps {
  value: string
  onChange: (value: string) => void
  type: TransactionType
  currency: CurrencyCode
  autoFocus?: boolean
  error?: string
}

/** Крупное поле суммы с цифровой клавиатурой. Хранит текст, разбор — в Money.parse. */
export function AmountInput({ value, onChange, type, currency, autoFocus = false, error }: AmountInputProps) {
  const ref = useRef<HTMLInputElement>(null)

  // Layout-эффект выполняется синхронно в том же тапе — это важно для iOS
  useLayoutEffect(() => {
    if (!autoFocus) return
    ref.current?.focus({ preventScroll: true })
    releaseKeyboardPrimer()
  }, [autoFocus])

  return (
    <div className={styles.wrapper}>
      <label className={styles.row} data-invalid={error ? true : undefined}>
        <span className="visually-hidden">Сумма</span>
        <span className={styles.sign} data-type={type} aria-hidden="true">
          {type === 'expense' ? '−' : '+'}
        </span>
        <input
          ref={ref}
          className={styles.input}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          placeholder="0"
          value={value}
          onChange={(event) => onChange(Money.sanitizeInput(event.target.value))}
          style={{ width: `${Math.max(value.length, 1) + 0.2}ch` }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'amount-error' : undefined}
        />
        <span className={styles.currency} aria-hidden="true">
          {Money.currencySymbol(currency)}
        </span>
      </label>
      {error && (
        <p id="amount-error" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
