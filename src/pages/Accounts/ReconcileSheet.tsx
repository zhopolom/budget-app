import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { SegmentedControl } from '../../components/SegmentedControl/SegmentedControl'
import { TextField } from '../../components/TextField/TextField'
import { useToast } from '../../components/Toast/toastContext'
import { planReconciliation, reconcileAccount } from '../../features/reconciliation/service'
import { NOTE_MAX_LENGTH } from '../../features/transactions/validation'
import type { Account, CurrencyCode, IsoDate, MinorUnits } from '../../types/entities'
import { Money, PARSE_ERROR_MESSAGES } from '../../utils/money'
import styles from './ReconcileSheet.module.css'

type Sign = 'positive' | 'negative'

/** Кредитка в минусе — обычное дело, а поле суммы знак не принимает: он задаётся отдельно. */
const SIGN_OPTIONS = [
  { value: 'positive', label: 'Остаток в плюсе' },
  { value: 'negative', label: 'В минусе' },
] as const satisfies readonly { value: Sign; label: string }[]

interface ReconcileSheetProps {
  account: Account
  /** Остаток по учёту Budget — живой: если он изменится, превью пересчитается. */
  current: MinorUnits
  currency: CurrencyCode
  today: IsoDate
  onDone: () => void
}

/**
 * Сверка остатка (ТЗ §16, §18): пользователь вводит остаток из банка,
 * видит разницу и явно создаёт корректировку. Ничего не создаётся,
 * пока остатки совпадают или сумма не введена.
 */
export function ReconcileSheet({ account, current, currency, today, onDone }: ReconcileSheetProps) {
  const [actualText, setActualText] = useState('')
  const [sign, setSign] = useState<Sign>(current < 0 ? 'negative' : 'positive')
  const [note, setNote] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const parsed = Money.parse(actualText)
  const actual: MinorUnits | null = parsed.ok ? (sign === 'negative' ? -parsed.value : parsed.value) : null
  const plan = actual === null ? null : planReconciliation(current, actual)
  const trimmedNote = note.trim()
  const noteError = trimmedNote.length > NOTE_MAX_LENGTH ? `Не длиннее ${NOTE_MAX_LENGTH} символов` : undefined
  const amountError = attempted && !parsed.ok ? PARSE_ERROR_MESSAGES[parsed.error] : undefined
  const canCreate = plan !== null && plan.direction !== null && !noteError && !busy

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (!plan || !canCreate) return

    setBusy(true)
    try {
      const created = await reconcileAccount({
        accountId: account.id,
        actual: plan.actual,
        expectedDifference: plan.difference,
        date: today,
        note: trimmedNote,
      })
      onDone()
      toast.show(
        created
          ? `Создана корректировка ${Money.format(plan.difference, currency, { sign: 'always' })}`
          : 'Остатки уже совпадают',
      )
    } catch (error) {
      // Остаток успел измениться — превью уже показывает новую разницу, пусть человек посмотрит ещё раз
      setBusy(false)
      toast.show(error instanceof Error ? error.message : 'Не удалось создать корректировку', { tone: 'error' })
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <p className={styles.hint}>
        Введите остаток, который показывает банк. Разница запишется корректировкой — она изменит остаток счёта,
        но не попадёт в расходы, доходы и бюджет.
      </p>

      <TextField
        label="Фактический баланс"
        placeholder="0"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        value={actualText}
        onChange={(event) => setActualText(Money.sanitizeInput(event.target.value))}
        suffix={Money.currencySymbol(currency)}
        error={amountError}
      />

      <SegmentedControl options={SIGN_OPTIONS} value={sign} onChange={setSign} label="Знак остатка" />

      <dl className={styles.summary} aria-live="polite">
        <div className={styles.row}>
          <dt>Текущий баланс Budget</dt>
          <dd>{Money.format(current, currency)}</dd>
        </div>
        <div className={styles.row}>
          <dt>Фактический баланс</dt>
          <dd>{actual === null ? '—' : Money.format(actual, currency)}</dd>
        </div>
        <div className={styles.row} data-total>
          <dt>Разница</dt>
          <dd data-tone={plan && plan.difference !== 0 ? (plan.difference > 0 ? 'positive' : 'negative') : undefined}>
            {plan === null ? '—' : Money.format(plan.difference, currency, { sign: 'always' })}
          </dd>
        </div>
      </dl>

      <p className={styles.outcome} data-match={plan?.direction === null || undefined}>
        {plan === null && 'Введите фактический баланс, чтобы увидеть разницу.'}
        {plan !== null && plan.direction === null && 'Остатки совпадают — корректировка не нужна.'}
        {plan !== null &&
          plan.direction !== null &&
          `Будет создана корректировка ${Money.format(plan.difference, currency, { sign: 'always' })}.`}
      </p>

      <TextField
        label="Комментарий"
        placeholder="Необязательно"
        value={note}
        maxLength={NOTE_MAX_LENGTH}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(event) => setNote(event.target.value)}
        error={noteError}
      />

      <Button type="submit" block disabled={!canCreate}>
        Создать корректировку
      </Button>
    </form>
  )
}
