import { useMemo, useState, type FormEvent } from 'react'
import { ACCOUNT_TYPE_ICONS } from '../../features/accounts/labels'
import { sortCategoriesByUsage } from '../../features/transactions/calculations'
import { TRANSACTION_TYPE_LABELS } from '../../features/transactions/labels'
import type { TransactionInput } from '../../features/transactions/model'
import type { TransactionEditorData } from '../../features/transactions/useTransactionEditorData'
import {
  NOTE_MAX_LENGTH,
  validateTransactionDraft,
  type TransactionDraft,
} from '../../features/transactions/validation'
import type { Id, TransactionType } from '../../types/entities'
import { toIsoDate } from '../../utils/dates'
import { AmountInput } from '../AmountInput/AmountInput'
import { Button } from '../Button/Button'
import { CategoryPicker } from '../CategoryPicker/CategoryPicker'
import { ChipGroup } from '../ChipGroup/ChipGroup'
import { SegmentedControl } from '../SegmentedControl/SegmentedControl'
import { TextField } from '../TextField/TextField'
import { useToast } from '../Toast/toastContext'
import styles from './TransactionForm.module.css'

const TYPE_OPTIONS = [
  { value: 'expense', label: TRANSACTION_TYPE_LABELS.expense },
  { value: 'income', label: TRANSACTION_TYPE_LABELS.income },
  { value: 'transfer', label: TRANSACTION_TYPE_LABELS.transfer },
] as const satisfies readonly { value: TransactionType; label: string }[]

interface TransactionFormProps {
  initial: TransactionDraft
  data: TransactionEditorData
  mode: 'create' | 'edit'
  autoFocusAmount?: boolean
  onSubmit: (input: TransactionInput) => Promise<void>
  /** «Повторить»: открывает новую форму с теми же данными и сегодняшней датой. */
  onDuplicate?: () => void
  onDelete?: () => void
}

function submitLabelFor(mode: 'create' | 'edit', type: TransactionType): string {
  if (mode === 'edit') return 'Сохранить'
  return type === 'transfer' ? 'Перевести' : 'Добавить'
}

export function TransactionForm({
  initial,
  data,
  mode,
  autoFocusAmount = false,
  onSubmit,
  onDuplicate,
  onDelete,
}: TransactionFormProps) {
  const [draft, setDraft] = useState(initial)
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Порядок категорий фиксируем на время работы с формой, чтобы плитки не прыгали
  const [usage] = useState(data.categoryUsage)
  const toast = useToast()

  const isTransfer = draft.type === 'transfer'

  const categories = useMemo(
    () => (isTransfer ? [] : sortCategoriesByUsage(data.categories.filter((category) => category.type === draft.type), usage)),
    [data.categories, usage, draft.type, isTransfer],
  )

  const accountChips = useMemo(
    () => data.accounts.map((account) => ({ value: account.id, label: account.name, icon: ACCOUNT_TYPE_ICONS[account.type] })),
    [data.accounts],
  )

  const result = validateTransactionDraft(draft, data)
  // Ошибки показываем только после первой попытки сохранить — и дальше обновляем на лету
  const errors = attempted && !result.ok ? result.errors : {}

  const update = (patch: Partial<TransactionDraft>) => setDraft((current) => ({ ...current, ...patch }))

  const changeType = (type: TransactionType) => {
    if (type === 'transfer') {
      // Счёт, который пользователь уже выбрал, становится счётом-источником
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

  const selectCategory = (categoryId: Id) => {
    update({ categoryId })
    // На цифровой клавиатуре iOS нет кнопки «Готово»: после выбора категории
    // прячем клавиатуру, чтобы стало видно кнопку сохранения
    if (draft.amountText !== '' && document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setAttempted(true)
    if (!result.ok) return

    setSubmitting(true)
    try {
      await onSubmit(result.value)
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Не удалось сохранить', { tone: 'error' })
      setSubmitting(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <SegmentedControl options={TYPE_OPTIONS} value={draft.type} onChange={changeType} label="Тип операции" />

      <AmountInput
        value={draft.amountText}
        onChange={(amountText) => update({ amountText })}
        type={draft.type}
        currency={data.settings.baseCurrency}
        autoFocus={autoFocusAmount}
        error={errors.amount}
      />

      {isTransfer ? (
        <>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Откуда</h2>
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
            <h2 className={styles.sectionTitle}>Куда</h2>
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
            <h2 className={styles.sectionTitle}>Категория</h2>
            <CategoryPicker categories={categories} value={draft.categoryId} onChange={selectCategory} error={errors.category} />
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Счёт</h2>
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

      <div className={styles.fields}>
        <TextField
          label="Комментарий"
          placeholder="Необязательно"
          value={draft.note}
          maxLength={NOTE_MAX_LENGTH}
          enterKeyHint="done"
          autoComplete="off"
          onChange={(event) => update({ note: event.target.value })}
          error={errors.note}
        />
        <TextField
          label="Дата"
          type="date"
          value={draft.date}
          // Кнопка «Очистить» в пикере iOS даёт пустую строку — возвращаем сегодня
          onChange={(event) => update({ date: event.target.value || toIsoDate(new Date()) })}
          error={errors.date}
        />
      </div>

      {(onDuplicate || onDelete) && (
        <div className={styles.actions}>
          {onDuplicate && (
            <Button variant="secondary" block onClick={onDuplicate} disabled={submitting}>
              Повторить операцию
            </Button>
          )}
          {onDelete && (
            <Button variant="danger" block onClick={onDelete} disabled={submitting}>
              Удалить операцию
            </Button>
          )}
        </div>
      )}

      <div className={styles.submitBar}>
        <div className={styles.submitInner}>
          <Button type="submit" block disabled={submitting}>
            {submitLabelFor(mode, draft.type)}
          </Button>
        </div>
      </div>
    </form>
  )
}
