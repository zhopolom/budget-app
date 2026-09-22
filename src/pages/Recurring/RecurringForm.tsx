import { useMemo, useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { CategoryPicker } from '../../components/CategoryPicker/CategoryPicker'
import { ChipGroup } from '../../components/ChipGroup/ChipGroup'
import { SegmentedControl } from '../../components/SegmentedControl/SegmentedControl'
import { TextField } from '../../components/TextField/TextField'
import { useToast } from '../../components/Toast/toastContext'
import { ACCOUNT_TYPE_ICONS } from '../../features/accounts/labels'
import { describeRecurrence } from '../../features/recurring/occurrences'
import type { RecurringInput } from '../../features/recurring/repository'
import {
  MAX_INTERVAL,
  RECURRING_NOTE_MAX_LENGTH,
  validateRecurringDraft,
  type RecurringDraft,
} from '../../features/recurring/validation'
import { sortCategoriesByUsage } from '../../features/transactions/calculations'
import { TRANSACTION_TYPE_LABELS } from '../../features/transactions/labels'
import type { TransactionEditorData } from '../../features/transactions/useTransactionEditorData'
import type { Id, ManualTransactionType, RecurrenceFrequency, RecurringExecutionMode } from '../../types/entities'
import { Money } from '../../utils/money'
import styles from './RecurringForm.module.css'

const TYPE_OPTIONS = [
  { value: 'expense', label: TRANSACTION_TYPE_LABELS.expense },
  { value: 'income', label: TRANSACTION_TYPE_LABELS.income },
  { value: 'transfer', label: TRANSACTION_TYPE_LABELS.transfer },
] as const satisfies readonly { value: ManualTransactionType; label: string }[]

const FREQUENCY_CHIPS = [
  { value: 'daily', label: 'День' },
  { value: 'weekly', label: 'Неделя' },
  { value: 'monthly', label: 'Месяц' },
  { value: 'yearly', label: 'Год' },
] as const satisfies readonly { value: RecurrenceFrequency; label: string }[]

const EXECUTION_OPTIONS = [
  { value: 'automatic', label: 'Записывать' },
  { value: 'confirm', label: 'Спрашивать' },
] as const satisfies readonly { value: RecurringExecutionMode; label: string }[]

const EXECUTION_HINTS: Record<RecurringExecutionMode, string> = {
  automatic: 'В день срока операция появится в истории сама.',
  confirm: 'В день срока появится на главной в «Ожидают подтверждения»: там её можно подтвердить, изменить или пропустить.',
}

interface RecurringFormProps {
  initial: RecurringDraft
  data: TransactionEditorData
  mode: 'create' | 'edit'
  onSubmit: (input: RecurringInput) => Promise<void>
  onDelete?: () => void
}

export function RecurringForm({ initial, data, mode, onSubmit, onDelete }: RecurringFormProps) {
  const [draft, setDraft] = useState(initial)
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [usage] = useState(data.categoryUsage)
  const toast = useToast()

  const isTransfer = draft.type === 'transfer'

  const categories = useMemo(
    () =>
      isTransfer
        ? []
        : sortCategoriesByUsage(data.categories.filter((category) => category.type === draft.type), usage),
    [data.categories, usage, draft.type, isTransfer],
  )

  const accountChips = useMemo(
    () => data.accounts.map((account) => ({ value: account.id, label: account.name, icon: ACCOUNT_TYPE_ICONS[account.type] })),
    [data.accounts],
  )

  const result = validateRecurringDraft(draft, data)
  const errors = attempted && !result.ok ? result.errors : {}
  const update = (patch: Partial<RecurringDraft>) => setDraft((current) => ({ ...current, ...patch }))

  const changeType = (type: ManualTransactionType) => {
    if (type === 'transfer') {
      // Счёт, который уже выбран, становится счётом-источником
      update({ type, fromAccountId: draft.fromAccountId ?? draft.accountId })
      return
    }
    const keepsCategory = data.categories.some((category) => category.id === draft.categoryId && category.type === type)
    update({
      type,
      categoryId: keepsCategory ? draft.categoryId : null,
      accountId: draft.accountId ?? draft.fromAccountId,
    })
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setAttempted(true)
    if (!result.ok) return

    setBusy(true)
    try {
      await onSubmit(result.value)
    } catch (error) {
      setBusy(false)
      toast.show(error instanceof Error ? error.message : 'Не удалось сохранить', { tone: 'error' })
    }
  }

  const interval = Number(draft.intervalText)
  const scheduleHint = Number.isInteger(interval) && interval >= 1 ? describeRecurrence(draft.frequency, interval) : null

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <SegmentedControl options={TYPE_OPTIONS} value={draft.type} onChange={changeType} label="Тип операции" />

      <TextField
        label="Сумма"
        placeholder="0"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        value={draft.amountText}
        onChange={(event) => update({ amountText: Money.sanitizeInput(event.target.value) })}
        suffix={Money.currencySymbol(data.settings.baseCurrency)}
        error={errors.amount}
      />

      {isTransfer ? (
        <>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Откуда</h3>
            <ChipGroup
              chips={accountChips}
              value={draft.fromAccountId}
              onChange={(fromAccountId) => update({ fromAccountId })}
              label="Счёт списания"
              layout="scroll"
            />
            {errors.fromAccount && <p className={styles.error}>{errors.fromAccount}</p>}
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Куда</h3>
            <ChipGroup
              chips={accountChips}
              value={draft.toAccountId}
              onChange={(toAccountId) => update({ toAccountId })}
              label="Счёт зачисления"
              layout="scroll"
            />
            {errors.toAccount && <p className={styles.error}>{errors.toAccount}</p>}
          </section>
        </>
      ) : (
        <>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Категория</h3>
            <CategoryPicker
              categories={categories}
              value={draft.categoryId}
              onChange={(categoryId: Id) => update({ categoryId })}
              error={errors.category}
            />
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Счёт</h3>
            <ChipGroup
              chips={accountChips}
              value={draft.accountId}
              onChange={(accountId) => update({ accountId })}
              label="Счёт"
              layout="scroll"
            />
            {errors.account && <p className={styles.error}>{errors.account}</p>}
          </section>
        </>
      )}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Повтор</h3>
        <ChipGroup
          chips={FREQUENCY_CHIPS}
          value={draft.frequency}
          onChange={(frequency) => update({ frequency })}
          label="Как часто повторять"
        />
        <div className={styles.row}>
          <TextField
            label="Каждые"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            value={draft.intervalText}
            maxLength={2}
            onChange={(event) => update({ intervalText: event.target.value.replace(/\D/g, '').slice(0, 2) })}
            error={errors.interval}
          />
          <p className={styles.hint}>{scheduleHint ?? `Число от 1 до ${MAX_INTERVAL}`}</p>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>В день срока</h3>
        <SegmentedControl
          options={EXECUTION_OPTIONS}
          value={draft.executionMode}
          onChange={(executionMode) => update({ executionMode })}
          label="Как создавать операцию"
        />
        <p className={styles.note}>{EXECUTION_HINTS[draft.executionMode]}</p>
      </section>

      <div className={styles.fields}>
        <TextField
          label="Комментарий"
          placeholder={isTransfer ? 'Например, На отпуск' : 'Например, Spotify'}
          value={draft.note}
          maxLength={RECURRING_NOTE_MAX_LENGTH}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(event) => update({ note: event.target.value })}
          error={errors.note}
        />
        <TextField
          label="Начало"
          type="date"
          value={draft.startDate}
          onChange={(event) => update({ startDate: event.target.value || draft.startDate })}
          error={errors.startDate}
        />
        <TextField
          label="Окончание (необязательно)"
          type="date"
          value={draft.endDate}
          onChange={(event) => update({ endDate: event.target.value })}
          error={errors.endDate}
        />
      </div>

      <div className={styles.actions}>
        <Button type="submit" block disabled={busy}>
          {mode === 'create' ? 'Создать' : 'Сохранить'}
        </Button>
        {onDelete && (
          <Button variant="danger" block onClick={onDelete} disabled={busy}>
            Удалить
          </Button>
        )}
      </div>
    </form>
  )
}
