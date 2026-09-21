import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { useConfirm } from '../../components/Confirm/confirmContext'
import { Sheet } from '../../components/Sheet/Sheet'
import { TextField } from '../../components/TextField/TextField'
import { useToast } from '../../components/Toast/toastContext'
import { categoriesRepository } from '../../features/categories/repository'
import {
  CATEGORY_ICON_CHOICES,
  CATEGORY_NAME_MAX_LENGTH,
  firstGrapheme,
  validateCategoryDraft,
} from '../../features/categories/validation'
import { transactionsRepository } from '../../features/transactions/repository'
import type { Category, CategoryType } from '../../types/entities'
import { keepFocus } from '../../utils/keepFocus'
import { pluralRu } from '../../utils/plural'
import styles from './CategorySheet.module.css'

interface CategorySheetProps {
  open: boolean
  /** null — создание новой категории типа type. */
  category: Category | null
  type: CategoryType
  existing: readonly Category[]
  onClose: () => void
}

export function CategorySheet({ open, category, type, existing, onClose }: CategorySheetProps) {
  const title = category ? 'Категория' : type === 'expense' ? 'Новая категория расходов' : 'Новая категория доходов'
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <CategoryForm category={category} type={type} existing={existing} onDone={onClose} />
    </Sheet>
  )
}

interface CategoryFormProps {
  category: Category | null
  type: CategoryType
  existing: readonly Category[]
  onDone: () => void
}

function CategoryForm({ category, type, existing, onDone }: CategoryFormProps) {
  const [name, setName] = useState(category?.name ?? '')
  const [icon, setIcon] = useState(category?.icon ?? CATEGORY_ICON_CHOICES[0])
  const [customIcon, setCustomIcon] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()

  const result = validateCategoryDraft({ name, icon, type: category?.type ?? type }, existing, category?.id ?? null)
  const errors = attempted && !result.ok ? result.errors : {}

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (!result.ok || busy) return

    setBusy(true)
    try {
      if (category) await categoriesRepository.update(category.id, result.value)
      else await categoriesRepository.create(result.value)
      onDone()
      toast.show(category ? 'Категория изменена' : 'Категория создана')
    } catch (error) {
      setBusy(false)
      toast.show(error instanceof Error ? error.message : 'Не удалось сохранить', { tone: 'error' })
    }
  }

  const handleDelete = async () => {
    if (!category) return
    const count = await transactionsRepository.countByCategory(category.id)
    const confirmed = await confirm({
      title: `Удалить «${category.name}»?`,
      message:
        count > 0
          ? `${count} ${pluralRu(count, ['операция останется', 'операции останутся', 'операций останутся'])} в истории с пометкой «Без категории».`
          : undefined,
      confirmLabel: 'Удалить',
      tone: 'danger',
    })
    if (!confirmed) return

    try {
      await categoriesRepository.remove(category.id)
      onDone()
      toast.show('Категория удалена')
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Не удалось удалить', { tone: 'error' })
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.preview} aria-hidden="true">
        <span className={styles.previewIcon}>{icon || '❔'}</span>
        <span className={styles.previewName}>{name.trim() || 'Название'}</span>
      </div>

      <TextField
        label="Название"
        value={name}
        maxLength={CATEGORY_NAME_MAX_LENGTH}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
      />

      <div className={styles.group}>
        <span className={styles.label} id="icon-label">
          Иконка
        </span>
        <div className={styles.icons} role="radiogroup" aria-labelledby="icon-label">
          {CATEGORY_ICON_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={choice === icon}
              aria-label={choice}
              className={styles.iconOption}
              onMouseDown={keepFocus}
              onClick={() => {
                setIcon(choice)
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
            if (value) setIcon(value)
          }}
          error={errors.icon}
        />
      </div>

      <div className={styles.actions}>
        <Button type="submit" block disabled={busy}>
          {category ? 'Сохранить' : 'Создать категорию'}
        </Button>
        {category && (
          <Button variant="danger" block onClick={handleDelete} disabled={busy}>
            Удалить категорию
          </Button>
        )}
      </div>
    </form>
  )
}
