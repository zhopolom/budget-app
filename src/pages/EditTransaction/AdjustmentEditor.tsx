import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { TextField } from '../../components/TextField/TextField'
import { useToast } from '../../components/Toast/toastContext'
import { ADJUSTMENT_ICON, ADJUSTMENT_TITLE, formatSignedAmount } from '../../features/transactions/labels'
import { transactionsRepository } from '../../features/transactions/repository'
import { NOTE_MAX_LENGTH } from '../../features/transactions/validation'
import type { Account, AdjustmentTransaction, CurrencyCode } from '../../types/entities'
import { isValidIsoDate, toIsoDate } from '../../utils/dates'
import styles from './AdjustmentEditor.module.css'

interface AdjustmentEditorProps {
  transaction: AdjustmentTransaction
  account: Account | undefined
  currency: CurrencyCode
  onSaved: () => void
  onDelete: () => void
}

/**
 * Корректировка остатка — результат сверки, а не трата: сумму и счёт здесь
 * не правят. Если сверка была ошибочной, корректировку удаляют и сверяют
 * заново — так у каждой корректировки остаётся один источник, сама сверка.
 * Дату и комментарий поправить можно.
 */
export function AdjustmentEditor({ transaction, account, currency, onSaved, onDelete }: AdjustmentEditorProps) {
  const [date, setDate] = useState(transaction.date)
  const [note, setNote] = useState(transaction.note)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const noteError = note.trim().length > NOTE_MAX_LENGTH ? `Не длиннее ${NOTE_MAX_LENGTH} символов` : undefined
  const dateError = isValidIsoDate(date) ? undefined : 'Укажите дату'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || noteError || dateError) return

    setBusy(true)
    try {
      await transactionsRepository.update(transaction.id, {
        type: 'adjustment',
        amount: transaction.amount,
        accountId: transaction.accountId,
        direction: transaction.direction,
        date,
        note: note.trim(),
      })
      onSaved()
    } catch (error) {
      setBusy(false)
      toast.show(error instanceof Error ? error.message : 'Не удалось сохранить', { tone: 'error' })
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <section className={styles.summary} aria-label={ADJUSTMENT_TITLE}>
        <span className={styles.icon} aria-hidden="true">
          {ADJUSTMENT_ICON}
        </span>
        <p className={styles.amount}>{formatSignedAmount(transaction, currency)}</p>
        <p className={styles.account}>{account?.name ?? 'Удалённый счёт'}</p>
        <p className={styles.hint}>
          {transaction.direction === 'increase'
            ? 'При сверке на счёте оказалось больше, чем в учёте.'
            : 'При сверке на счёте оказалось меньше, чем в учёте.'}{' '}
          Сумму корректировки не меняют: если сверка была ошибочной, удалите её и сверьте счёт заново.
        </p>
      </section>

      <div className={styles.fields}>
        <TextField
          label="Комментарий"
          placeholder="Необязательно"
          value={note}
          maxLength={NOTE_MAX_LENGTH}
          enterKeyHint="done"
          autoComplete="off"
          onChange={(event) => setNote(event.target.value)}
          error={noteError}
        />
        <TextField
          label="Дата"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value || toIsoDate(new Date()))}
          error={dateError}
        />
      </div>

      <div className={styles.actions}>
        <Button type="submit" block disabled={busy}>
          Сохранить
        </Button>
        <Button variant="danger" block onClick={onDelete} disabled={busy}>
          Удалить корректировку
        </Button>
      </div>
    </form>
  )
}
