import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { Sheet } from '../../components/Sheet/Sheet'
import { TextField } from '../../components/TextField/TextField'
import type { CurrencyCode, MinorUnits } from '../../types/entities'
import { Money, PARSE_ERROR_MESSAGES } from '../../utils/money'
import styles from './AmountSheet.module.css'

interface AmountSheetProps {
  open: boolean
  title: string
  label: string
  hint?: string
  /** Текущее значение; 0 — ещё не задано. */
  value: MinorUnits
  currency: CurrencyCode
  /** Подпись кнопки удаления, если значение уже задано. */
  clearLabel?: string
  /** Флажок под полем — например, переносить ли остаток лимита. */
  option?: { label: string; hint?: string; checked: boolean }
  /** Второй аргумент — состояние флажка (false, если флажка нет). */
  onSave: (value: MinorUnits, option: boolean) => Promise<void> | void
  onClose: () => void
}

/**
 * Ввод одной суммы в нижней шторке: общий бюджет, лимит категории,
 * сумма регулярной операции. Пустое поле означает «убрать».
 */
export function AmountSheet({
  open,
  title,
  label,
  hint,
  value,
  currency,
  clearLabel = 'Убрать',
  option,
  onSave,
  onClose,
}: AmountSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {/* key: при смене категории поле стартует с её собственной суммы */}
      <AmountForm
        key={`${title}:${value}:${option?.checked ?? ''}`}
        label={label}
        hint={hint}
        value={value}
        currency={currency}
        clearLabel={clearLabel}
        option={option}
        onSave={onSave}
        onClose={onClose}
      />
    </Sheet>
  )
}

type AmountFormProps = Omit<AmountSheetProps, 'open' | 'title'>

function AmountForm({ label, hint, value, currency, clearLabel, option, onSave, onClose }: AmountFormProps) {
  const [text, setText] = useState(() => (value > 0 ? Money.toInputString(value) : ''))
  const [checked, setChecked] = useState(option?.checked ?? false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const submit = async (amount: MinorUnits) => {
    setBusy(true)
    try {
      await onSave(amount, checked)
      onClose()
    } catch (saveError) {
      setBusy(false)
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить')
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return

    // Пустое поле — осознанное «убрать», а не ошибка ввода
    const trimmed = text.trim()
    if (trimmed === '') {
      await submit(0)
      return
    }

    const parsed = Money.parse(trimmed)
    if (!parsed.ok) {
      setError(PARSE_ERROR_MESSAGES[parsed.error])
      return
    }
    await submit(parsed.value)
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <TextField
        label={label}
        placeholder="0"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        autoFocus
        value={text}
        onChange={(event) => {
          setText(Money.sanitizeInput(event.target.value))
          setError(undefined)
        }}
        suffix={Money.currencySymbol(currency)}
        error={error}
      />

      {hint && <p className={styles.hint}>{hint}</p>}

      {option && (
        <label className={styles.option}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span className={styles.optionText}>
            <span className={styles.optionTitle}>{option.label}</span>
            {option.hint && <span className={styles.optionHint}>{option.hint}</span>}
          </span>
        </label>
      )}

      <div className={styles.actions}>
        <Button type="submit" block disabled={busy}>
          Сохранить
        </Button>
        {value > 0 && (
          <Button variant="ghost" block onClick={() => void submit(0)} disabled={busy}>
            {clearLabel}
          </Button>
        )}
      </div>
    </form>
  )
}
