import { useMemo, useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { CategoryPicker } from '../../components/CategoryPicker/CategoryPicker'
import { ChipGroup } from '../../components/ChipGroup/ChipGroup'
import { SegmentedControl } from '../../components/SegmentedControl/SegmentedControl'
import { TextField } from '../../components/TextField/TextField'
import { useToast } from '../../components/Toast/toastContext'
import { ACCOUNT_TYPE_ICONS } from '../../features/accounts/labels'
import { countMatches, RULE_MATCH_TYPE_LABELS, RULE_MATCH_TYPES } from '../../features/rules/matching'
import { categoryRulesRepository } from '../../features/rules/repository'
import {
  draftFromRule,
  RULE_NAME_MAX_LENGTH,
  RULE_PATTERN_MAX_LENGTH,
  validateRuleDraft,
  type RuleDraft,
} from '../../features/rules/validation'
import type { CategoryRule, CategoryType, Id, RuleMatchType } from '../../types/entities'
import { pluralRu } from '../../utils/plural'
import styles from './RuleForm.module.css'
import type { RulesData } from './useRulesData'

/** Значение чипа «Все счета»: у ChipGroup значения — строки. */
const ANY_ACCOUNT = '__any__'

const MATCH_OPTIONS = RULE_MATCH_TYPES.map((value) => ({ value, label: RULE_MATCH_TYPE_LABELS[value] }))

const TYPE_OPTIONS = [
  { value: 'expense', label: 'Расход' },
  { value: 'income', label: 'Доход' },
] as const satisfies readonly { value: CategoryType; label: string }[]

interface RuleFormProps {
  /** null — новое правило. */
  rule: CategoryRule | null
  data: RulesData
  /** Подставить шаблон и категорию — так работает «Всегда относить …?» из импорта. */
  defaults?: Partial<RuleDraft>
  onDone: () => void
  onDelete?: () => void
}

export function RuleForm({ rule, data, defaults, onDone, onDelete }: RuleFormProps) {
  const [draft, setDraft] = useState<RuleDraft>(() => draftFromRule(rule, defaults))
  const initialType = data.categories.find((category) => category.id === draft.categoryId)?.type ?? 'expense'
  const [type, setType] = useState<CategoryType>(initialType)
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const categories = useMemo(() => data.categories.filter((category) => category.type === type), [data.categories, type])
  const accountChips = [
    { value: ANY_ACCOUNT, label: 'Все счета' },
    ...data.accounts.map((account) => ({ value: account.id, label: account.name, icon: ACCOUNT_TYPE_ICONS[account.type] })),
  ]

  const result = validateRuleDraft(draft, data.categories, data.accounts)
  const errors = attempted && !result.ok ? result.errors : {}
  const update = (patch: Partial<RuleDraft>) => setDraft((current) => ({ ...current, ...patch }))

  // Превью (ТЗ §59): сколько существующих операций подошло бы — считается на лету, ничего не меняя
  const matches = useMemo(
    () =>
      countMatches(
        { matchType: draft.matchType, pattern: draft.pattern, ...(draft.accountId ? { accountId: draft.accountId } : {}) },
        data.descriptions,
      ),
    [draft.matchType, draft.pattern, draft.accountId, data.descriptions],
  )

  const changeType = (next: CategoryType) => {
    setType(next)
    const keeps = data.categories.some((category) => category.id === draft.categoryId && category.type === next)
    if (!keeps) update({ categoryId: null })
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (!result.ok || busy) return

    setBusy(true)
    try {
      if (rule) await categoryRulesRepository.update(rule.id, result.value)
      else await categoryRulesRepository.create(result.value)
      onDone()
      toast.show(rule ? 'Правило изменено' : 'Правило создано')
    } catch (error) {
      setBusy(false)
      toast.show(error instanceof Error ? error.message : 'Не удалось сохранить', { tone: 'error' })
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Если описание</h3>
        <SegmentedControl
          options={MATCH_OPTIONS}
          value={draft.matchType}
          onChange={(matchType: RuleMatchType) => update({ matchType })}
          label="Как сравнивать"
        />
        <TextField
          label="Текст"
          placeholder="Например, Spotify"
          value={draft.pattern}
          maxLength={RULE_PATTERN_MAX_LENGTH}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(event) => update({ pattern: event.target.value })}
          error={errors.pattern}
        />
        <p className={styles.preview} aria-live="polite">
          {draft.pattern.trim() === ''
            ? 'Регистр и лишние пробелы не важны.'
            : matches === 0
              ? 'Среди существующих операций совпадений нет.'
              : `Это правило совпадает с ${matches} ${pluralRu(matches, ['операцией', 'операциями', 'операциями'])}. Они не изменятся — правило действует на импорт.`}
        </p>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>То категория</h3>
        <SegmentedControl options={TYPE_OPTIONS} value={type} onChange={changeType} label="Тип категории" />
        <CategoryPicker
          categories={categories}
          value={draft.categoryId}
          onChange={(categoryId: Id) => update({ categoryId })}
          error={errors.category}
        />
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Только для счёта</h3>
        <ChipGroup
          chips={accountChips}
          value={draft.accountId ?? ANY_ACCOUNT}
          onChange={(value) => update({ accountId: value === ANY_ACCOUNT ? null : value })}
          label="Счёт правила"
          layout="scroll"
        />
        {errors.account && <p className={styles.error}>{errors.account}</p>}
      </section>

      <div className={styles.fields}>
        <TextField
          label="Название (необязательно)"
          placeholder="Как в списке правил"
          value={draft.name}
          maxLength={RULE_NAME_MAX_LENGTH}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(event) => update({ name: event.target.value })}
          error={errors.name}
        />
        <div className={styles.row}>
          <TextField
            label="Приоритет"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            value={draft.priorityText}
            maxLength={3}
            onChange={(event) => update({ priorityText: event.target.value.replace(/\D/g, '').slice(0, 3) })}
            error={errors.priority}
          />
          <p className={styles.hint}>Если подходит несколько правил, побеждает большее число.</p>
        </div>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={draft.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
          <span className={styles.toggleTitle}>Правило включено</span>
        </label>
      </div>

      <div className={styles.actions}>
        <Button type="submit" block disabled={busy}>
          {rule ? 'Сохранить' : 'Создать правило'}
        </Button>
        {onDelete && (
          <Button variant="danger" block onClick={onDelete} disabled={busy}>
            Удалить правило
          </Button>
        )}
      </div>
    </form>
  )
}
