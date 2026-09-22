import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { Sheet } from '../../components/Sheet/Sheet'
import { TextField } from '../../components/TextField/TextField'
import { TEMPLATE_NAME_MAX_LENGTH } from '../../features/budgets/templatesRepository'
import { MISSING_CATEGORY } from '../../features/categories/defaults'
import type { BudgetTemplate, Category, CurrencyCode } from '../../types/entities'
import { Money } from '../../utils/money'
import styles from './TemplateSheets.module.css'

interface TemplateSheetProps {
  /** null — шторка закрыта. */
  template: BudgetTemplate | null
  categories: readonly Category[]
  currency: CurrencyCode
  /** «сентябрю» — куда применяем. */
  monthDative: string
  onApply: (template: BudgetTemplate) => void
  onRemove: (template: BudgetTemplate) => void
  onClose: () => void
}

/** Содержимое шаблона и два действия: применить к выбранному месяцу или удалить. */
export function TemplateSheet({ template, categories, currency, monthDative, onApply, onRemove, onClose }: TemplateSheetProps) {
  return (
    <Sheet open={template !== null} onClose={onClose} title={template?.name ?? 'Шаблон'}>
      {template && (
        <div className={styles.panel}>
          <ListCard label="Что в шаблоне">
            {template.totalLimit > 0 && (
              <ListItem>
                <ListRow icon="🎯" title="Общий бюджет" value={Money.format(template.totalLimit, currency)} />
              </ListItem>
            )}
            {template.categoryLimits.map((limit) => {
              const category = categories.find((item) => item.id === limit.categoryId)
              return (
                <ListItem key={limit.categoryId}>
                  <ListRow
                    icon={category?.icon ?? MISSING_CATEGORY.icon}
                    title={category?.name ?? MISSING_CATEGORY.name}
                    value={Money.format(limit.limitAmount, currency)}
                  />
                </ListItem>
              )
            })}
          </ListCard>

          <div className={styles.actions}>
            <Button block onClick={() => onApply(template)}>
              Применить к {monthDative}
            </Button>
            <Button variant="danger" block onClick={() => onRemove(template)}>
              Удалить шаблон
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

interface TemplateNameSheetProps {
  open: boolean
  onSave: (name: string) => Promise<void>
  onClose: () => void
}

/** Название нового шаблона: всё остальное берётся из бюджета месяца. */
export function TemplateNameSheet({ open, onSave, onClose }: TemplateNameSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Сохранить как шаблон">
      {/* key: после закрытия поле стартует пустым */}
      {open && <NameForm onSave={onSave} onClose={onClose} />}
    </Sheet>
  )
}

function NameForm({ onSave, onClose }: Omit<TemplateNameSheetProps, 'open'>) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (name.trim() === '') {
      setError('Введите название')
      return
    }
    setBusy(true)
    try {
      await onSave(name)
      onClose()
    } catch (saveError) {
      setBusy(false)
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить')
    }
  }

  return (
    <form className={styles.panel} onSubmit={handleSubmit} noValidate>
      <TextField
        label="Название шаблона"
        placeholder="Например, Обычный месяц"
        value={name}
        maxLength={TEMPLATE_NAME_MAX_LENGTH}
        autoComplete="off"
        enterKeyHint="done"
        autoFocus
        onChange={(event) => {
          setName(event.target.value)
          setError(undefined)
        }}
        error={error}
      />
      <p className={styles.hint}>В шаблон попадут общий бюджет и лимиты категорий этого месяца.</p>
      <Button type="submit" block disabled={busy}>
        Сохранить
      </Button>
    </form>
  )
}
