import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { ChipGroup } from '../../components/ChipGroup/ChipGroup'
import { TextField } from '../../components/TextField/TextField'
import { useToast } from '../../components/Toast/toastContext'
import { ACCOUNT_TYPE_ICONS } from '../../features/accounts/labels'
import { firstGrapheme } from '../../features/categories/validation'
import { goalsRepository } from '../../features/goals/repository'
import {
  draftFromGoal,
  GOAL_ICON_CHOICES,
  GOAL_NAME_MAX_LENGTH,
  validateGoalDraft,
  type GoalDraft,
} from '../../features/goals/validation'
import type { Account, CurrencyCode, SavingsGoal } from '../../types/entities'
import { keepFocus } from '../../utils/keepFocus'
import { Money } from '../../utils/money'
import styles from './GoalForm.module.css'

/** Значение чипа «Без счёта»: у ChipGroup значения — строки. */
const NO_ACCOUNT = '__none__'

interface GoalFormProps {
  /** null — новая цель. */
  goal: SavingsGoal | null
  accounts: readonly Account[]
  currency: CurrencyCode
  onDone: () => void
  onArchiveToggle?: () => void
  onDelete?: () => void
}

export function GoalForm({ goal, accounts, currency, onDone, onArchiveToggle, onDelete }: GoalFormProps) {
  const [draft, setDraft] = useState<GoalDraft>(() => draftFromGoal(goal))
  const [customIcon, setCustomIcon] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const savings = accounts.filter((account) => account.type === 'savings')
  const accountChips = [
    { value: NO_ACCOUNT, label: 'Без счёта' },
    ...savings.map((account) => ({ value: account.id, label: account.name, icon: ACCOUNT_TYPE_ICONS[account.type] })),
  ]

  const result = validateGoalDraft(draft, accounts)
  const errors = attempted && !result.ok ? result.errors : {}
  const update = (patch: Partial<GoalDraft>) => setDraft((current) => ({ ...current, ...patch }))

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (!result.ok || busy) return

    setBusy(true)
    try {
      if (goal) await goalsRepository.update(goal.id, result.value)
      else await goalsRepository.create(result.value)
      onDone()
      toast.show(goal ? 'Цель изменена' : 'Цель создана')
    } catch (error) {
      setBusy(false)
      toast.show(error instanceof Error ? error.message : 'Не удалось сохранить', { tone: 'error' })
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.preview} aria-hidden="true">
        <span className={styles.previewIcon}>{draft.icon || '❔'}</span>
        <span className={styles.previewName}>{draft.name.trim() || 'Название цели'}</span>
      </div>

      <TextField
        label="Название"
        placeholder="Например, MacBook"
        value={draft.name}
        maxLength={GOAL_NAME_MAX_LENGTH}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(event) => update({ name: event.target.value })}
        error={errors.name}
      />

      <div className={styles.group}>
        <span className={styles.label} id="goal-icon-label">
          Иконка
        </span>
        <div className={styles.icons} role="radiogroup" aria-labelledby="goal-icon-label">
          {GOAL_ICON_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={choice === draft.icon}
              aria-label={choice}
              className={styles.iconOption}
              onMouseDown={keepFocus}
              onClick={() => {
                update({ icon: choice })
                setCustomIcon('')
              }}
            >
              {choice}
            </button>
          ))}
        </div>
        <TextField
          label="Или свой эмодзи"
          placeholder="🙂"
          value={customIcon}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(event) => {
            const value = firstGrapheme(event.target.value)
            setCustomIcon(value)
            if (value) update({ icon: value })
          }}
          error={errors.icon}
        />
      </div>

      <TextField
        label="Сумма цели"
        placeholder="0"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        value={draft.targetAmountText}
        onChange={(event) => update({ targetAmountText: Money.sanitizeInput(event.target.value) })}
        suffix={Money.currencySymbol(currency)}
        error={errors.targetAmount}
      />

      <TextField
        label="Срок (необязательно)"
        type="date"
        value={draft.targetDate}
        onChange={(event) => update({ targetDate: event.target.value })}
        error={errors.targetDate}
      />

      <section className={styles.group}>
        <span className={styles.label}>Откуда считать накопленное</span>
        <ChipGroup
          chips={accountChips}
          value={draft.linkedAccountId ?? NO_ACCOUNT}
          onChange={(value) => update({ linkedAccountId: value === NO_ACCOUNT ? null : value })}
          label="Накопительный счёт"
          layout="scroll"
        />
        <p className={styles.hint}>
          {savings.length === 0
            ? 'Чтобы прогресс считался сам, создайте счёт типа «Накопления» и свяжите цель с ним.'
            : draft.linkedAccountId
              ? 'Прогресс — остаток этого счёта: перевод на него и есть пополнение цели.'
              : 'Без счёта накопленное вводится вручную.'}
        </p>
        {errors.linkedAccount && <p className={styles.error}>{errors.linkedAccount}</p>}
      </section>

      {draft.linkedAccountId === null && (
        <TextField
          label="Уже накоплено"
          placeholder="0"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          value={draft.currentAmountText}
          onChange={(event) => update({ currentAmountText: Money.sanitizeInput(event.target.value) })}
          suffix={Money.currencySymbol(currency)}
          error={errors.currentAmount}
        />
      )}

      <div className={styles.actions}>
        <Button type="submit" block disabled={busy}>
          {goal ? 'Сохранить' : 'Создать цель'}
        </Button>
        {goal && onArchiveToggle && (
          <Button variant="secondary" block onClick={onArchiveToggle} disabled={busy}>
            {goal.isArchived ? 'Вернуть из архива' : 'В архив'}
          </Button>
        )}
        {goal && onDelete && (
          <Button variant="danger" block onClick={onDelete} disabled={busy}>
            Удалить цель
          </Button>
        )}
      </div>
    </form>
  )
}
