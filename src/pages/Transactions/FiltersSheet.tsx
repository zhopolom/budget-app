import { useState } from 'react'
import { Button } from '../../components/Button/Button'
import { ChipGroup } from '../../components/ChipGroup/ChipGroup'
import { MultiChipGroup } from '../../components/ChipGroup/MultiChipGroup'
import { Sheet } from '../../components/Sheet/Sheet'
import { TextField } from '../../components/TextField/TextField'
import { ACCOUNT_TYPE_ICONS } from '../../features/accounts/labels'
import {
  countActiveFilters,
  EMPTY_FILTERS,
  PERIOD_LABELS,
  type PeriodPreset,
  type TransactionFilters,
} from '../../features/transactions/filters'
import { TRANSACTION_TYPE_LABELS } from '../../features/transactions/labels'
import type { Account, Category, CurrencyCode, TransactionType } from '../../types/entities'
import { Money } from '../../utils/money'
import styles from './FiltersSheet.module.css'

const TYPE_CHIPS = (['expense', 'income', 'transfer', 'adjustment'] as const).map((type) => ({
  value: type,
  label: TRANSACTION_TYPE_LABELS[type],
})) satisfies readonly { value: TransactionType; label: string }[]

const PERIOD_CHIPS = (['month', 'quarter', 'year', 'all', 'custom'] as const).map((period) => ({
  value: period,
  label: PERIOD_LABELS[period],
}))

interface FiltersSheetProps {
  open: boolean
  value: TransactionFilters
  accounts: readonly Account[]
  categories: readonly Category[]
  currency: CurrencyCode
  onApply: (filters: TransactionFilters) => void
  onClose: () => void
}

export function FiltersSheet({ open, value, accounts, categories, currency, onApply, onClose }: FiltersSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Фильтры">
      {/* key: шторка всегда открывается на актуальных фильтрах */}
      <FiltersForm
        key={open ? 'open' : 'closed'}
        value={value}
        accounts={accounts}
        categories={categories}
        currency={currency}
        onApply={onApply}
        onClose={onClose}
      />
    </Sheet>
  )
}

type FiltersFormProps = Omit<FiltersSheetProps, 'open'>

function FiltersForm({ value, accounts, categories, currency, onApply, onClose }: FiltersFormProps) {
  const [draft, setDraft] = useState(value)
  const [minText, setMinText] = useState(() => (draft.minAmount === null ? '' : Money.toInputString(draft.minAmount)))
  const [maxText, setMaxText] = useState(() => (draft.maxAmount === null ? '' : Money.toInputString(draft.maxAmount)))

  const update = (patch: Partial<TransactionFilters>) => setDraft((current) => ({ ...current, ...patch }))

  const toggle = <T extends string>(list: readonly T[], item: T): T[] =>
    list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]

  const parseAmount = (text: string) => {
    const parsed = Money.parse(text)
    return parsed.ok && parsed.value > 0 ? parsed.value : null
  }

  const apply = () => {
    onApply({ ...draft, minAmount: parseAmount(minText), maxAmount: parseAmount(maxText) })
    onClose()
  }

  const reset = () => {
    setDraft(EMPTY_FILTERS)
    setMinText('')
    setMaxText('')
    onApply(EMPTY_FILTERS)
    onClose()
  }

  const accountChips = accounts.map((account) => ({
    value: account.id,
    label: account.name,
    icon: ACCOUNT_TYPE_ICONS[account.type],
  }))
  const categoryChips = categories.map((category) => ({
    value: category.id,
    label: category.name,
    icon: category.icon,
  }))

  return (
    <div className={styles.form}>
      <section className={styles.section}>
        <h3 className={styles.title}>Тип</h3>
        <MultiChipGroup
          chips={TYPE_CHIPS}
          values={draft.types}
          onToggle={(type) => update({ types: toggle(draft.types, type) })}
          label="Тип операции"
        />
      </section>

      <section className={styles.section}>
        <h3 className={styles.title}>Период</h3>
        <ChipGroup
          chips={PERIOD_CHIPS}
          value={draft.period}
          onChange={(period: PeriodPreset) => update({ period })}
          label="Период"
        />
        {draft.period === 'custom' && (
          <div className={styles.range}>
            <TextField
              label="С"
              type="date"
              value={draft.from ?? ''}
              onChange={(event) => update({ from: event.target.value || null })}
            />
            <TextField
              label="По"
              type="date"
              value={draft.to ?? ''}
              onChange={(event) => update({ to: event.target.value || null })}
            />
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.title}>Счёт</h3>
        <MultiChipGroup
          chips={accountChips}
          values={draft.accountIds}
          onToggle={(id) => update({ accountIds: toggle(draft.accountIds, id) })}
          label="Счёт"
        />
      </section>

      <section className={styles.section}>
        <h3 className={styles.title}>Категория</h3>
        <MultiChipGroup
          chips={categoryChips}
          values={draft.categoryIds}
          onToggle={(id) => update({ categoryIds: toggle(draft.categoryIds, id) })}
          label="Категория"
        />
        {draft.categoryIds.length > 0 && draft.types.includes('transfer') && (
          <p className={styles.hint}>У переводов нет категории — они не попадут в результат.</p>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.title}>Сумма</h3>
        <div className={styles.range}>
          <TextField
            label="От"
            placeholder="0"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            value={minText}
            onChange={(event) => setMinText(Money.sanitizeInput(event.target.value))}
            suffix={Money.currencySymbol(currency)}
          />
          <TextField
            label="До"
            placeholder="∞"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            value={maxText}
            onChange={(event) => setMaxText(Money.sanitizeInput(event.target.value))}
            suffix={Money.currencySymbol(currency)}
          />
        </div>
      </section>

      <div className={styles.actions}>
        <Button block onClick={apply}>
          Показать
        </Button>
        {countActiveFilters(draft) > 0 && (
          <Button variant="ghost" block onClick={reset}>
            Сбросить фильтры
          </Button>
        )}
      </div>
    </div>
  )
}
