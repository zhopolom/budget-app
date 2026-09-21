import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { ChipGroup } from '../../components/ChipGroup/ChipGroup'
import { TextField } from '../../components/TextField/TextField'
import { useToast } from '../../components/Toast/toastContext'
import { ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES } from '../../features/accounts/labels'
import { accountsRepository } from '../../features/accounts/repository'
import { ACCOUNT_NAME_MAX_LENGTH, draftFromAccount, validateAccountDraft } from '../../features/accounts/validation'
import type { Account, CurrencyCode } from '../../types/entities'
import { Money } from '../../utils/money'
import styles from './AccountForm.module.css'

const TYPE_CHIPS = ACCOUNT_TYPES.map((type) => ({ value: type, label: ACCOUNT_TYPE_LABELS[type], icon: ACCOUNT_TYPE_ICONS[type] }))

interface AccountFormProps {
  /** null — создание нового счёта. */
  account: Account | null
  currency: CurrencyCode
  onSaved: () => void
  /** Есть только у существующего счёта. */
  onDelete?: () => void
}

export function AccountForm({ account, currency, onSaved, onDelete }: AccountFormProps) {
  const [draft, setDraft] = useState(() => draftFromAccount(account))
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const result = validateAccountDraft(draft)
  const errors = attempted && !result.ok ? result.errors : {}

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (!result.ok || busy) return

    setBusy(true)
    try {
      if (account) await accountsRepository.update(account.id, result.value)
      else await accountsRepository.create(result.value, currency)
      onSaved()
      toast.show(account ? 'Счёт изменён' : 'Счёт создан')
    } catch (error) {
      setBusy(false)
      toast.show(error instanceof Error ? error.message : 'Не удалось сохранить', { tone: 'error' })
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <TextField
        label="Название"
        placeholder="Например, Monobank"
        value={draft.name}
        maxLength={ACCOUNT_NAME_MAX_LENGTH}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        error={errors.name}
      />

      <div className={styles.group}>
        <span className={styles.label}>Тип</span>
        <ChipGroup chips={TYPE_CHIPS} value={draft.type} onChange={(type) => setDraft({ ...draft, type })} label="Тип счёта" />
      </div>

      <TextField
        label="Начальный остаток"
        placeholder="0"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        value={draft.initialBalanceText}
        onChange={(event) => setDraft({ ...draft, initialBalanceText: Money.sanitizeInput(event.target.value) })}
        suffix={Money.currencySymbol(currency)}
        error={errors.initialBalance}
      />

      <div className={styles.actions}>
        <Button type="submit" block disabled={busy}>
          {account ? 'Сохранить' : 'Создать счёт'}
        </Button>
        {onDelete && (
          <Button variant="danger" block onClick={onDelete} disabled={busy}>
            Удалить счёт
          </Button>
        )}
      </div>
    </form>
  )
}
