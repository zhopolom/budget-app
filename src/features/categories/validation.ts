import type { Category, CategoryType, Id } from '../../types/entities'
import type { ValidationResult } from '../../types/validation'

export const CATEGORY_NAME_MAX_LENGTH = 24

export type CategoryInput = Pick<Category, 'name' | 'icon' | 'type'>

export interface CategoryDraft {
  name: string
  icon: string
  type: CategoryType
}

export type CategoryField = 'name' | 'icon'

/** Первый видимый символ: «👨‍👩‍👧» — это один символ из нескольких кодовых точек. */
export function firstGrapheme(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  if (typeof Intl.Segmenter === 'function') {
    const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)[Symbol.iterator]().next()
    return first.done ? '' : first.value.segment
  }
  return Array.from(trimmed)[0] ?? ''
}

export function validateCategoryDraft(
  draft: CategoryDraft,
  existing: readonly Category[],
  editingId: Id | null,
): ValidationResult<CategoryInput, CategoryField> {
  const errors: Partial<Record<CategoryField, string>> = {}

  const name = draft.name.trim()
  const icon = firstGrapheme(draft.icon)
  const isDuplicate = existing.some(
    (category) =>
      category.id !== editingId &&
      category.type === draft.type &&
      category.name.trim().toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'),
  )

  if (name === '') errors.name = 'Введите название'
  else if (name.length > CATEGORY_NAME_MAX_LENGTH) errors.name = `Не длиннее ${CATEGORY_NAME_MAX_LENGTH} символов`
  else if (isDuplicate) errors.name = 'Такая категория уже есть'

  if (icon === '') errors.icon = 'Выберите иконку'

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { name, icon, type: draft.type } }
}

/** Набор для выбора иконки новой категории. */
export const CATEGORY_ICON_CHOICES = [
  '🛒', '🍎', '🥖', '🍕', '🍔', '☕', '🍺', '🍷',
  '🚕', '🚌', '🚗', '⛽', '✈️', '🚲', '🏠', '💡',
  '📱', '💻', '🎮', '🎬', '🎵', '📚', '🎓', '💊',
  '🏥', '💪', '👕', '👟', '💄', '💇', '🎁', '🐾',
  '👶', '🔧', '🧹', '🎨', '⚽', '🏖️', '🧾', '💰',
] as const
