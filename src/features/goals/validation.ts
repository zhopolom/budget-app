import type { Account, Id, IsoDate, MinorUnits, SavingsGoal } from '../../types/entities'
import type { ValidationResult } from '../../types/validation'
import { isValidIsoDate } from '../../utils/dates'
import { Money, PARSE_ERROR_MESSAGES } from '../../utils/money'
import { firstGrapheme } from '../categories/validation'

export const GOAL_NAME_MAX_LENGTH = 40
export const DEFAULT_GOAL_ICON = '🎯'

/** Набор для выбора иконки цели. */
export const GOAL_ICON_CHOICES = [
  '🎯', '💻', '📱', '✈️', '🏖️', '🚗', '🏠', '🎓',
  '💍', '🎁', '🛋️', '🚲', '📷', '🎸', '🐾', '🛡️',
] as const

/**
 * Что сохраняет форма. null вместо отсутствующих полей — чтобы репозиторий
 * явно снимал поле, а не оставлял старое значение.
 */
export interface GoalInput {
  name: string
  icon: string
  targetAmount: MinorUnits
  targetDate: IsoDate | null
  linkedAccountId: Id | null
  /** Только у цели без счёта; у связанной — null. */
  currentAmount: MinorUnits | null
}

export interface GoalDraft {
  name: string
  icon: string
  targetAmountText: string
  /** Пустая строка — без срока. */
  targetDate: string
  linkedAccountId: Id | null
  currentAmountText: string
}

export type GoalField = 'name' | 'icon' | 'targetAmount' | 'targetDate' | 'linkedAccount' | 'currentAmount'

export function validateGoalDraft(
  draft: GoalDraft,
  accounts: readonly Account[],
): ValidationResult<GoalInput, GoalField> {
  const errors: Partial<Record<GoalField, string>> = {}

  const name = draft.name.trim()
  if (name === '') errors.name = 'Введите название'
  else if (name.length > GOAL_NAME_MAX_LENGTH) errors.name = `Не длиннее ${GOAL_NAME_MAX_LENGTH} символов`

  const icon = firstGrapheme(draft.icon)
  if (icon === '') errors.icon = 'Выберите иконку'

  const target = Money.parse(draft.targetAmountText)
  if (!target.ok) errors.targetAmount = PARSE_ERROR_MESSAGES[target.error]
  else if (target.value === 0) errors.targetAmount = PARSE_ERROR_MESSAGES.empty

  const targetDate = draft.targetDate.trim()
  if (targetDate !== '' && !isValidIsoDate(targetDate)) errors.targetDate = 'Укажите срок'

  // Связать можно только с накопительным счётом: остаток карты — не накопления
  const account = draft.linkedAccountId === null ? null : accounts.find((item) => item.id === draft.linkedAccountId)
  if (draft.linkedAccountId !== null && !account) errors.linkedAccount = 'Выберите счёт'
  else if (account && account.type !== 'savings') errors.linkedAccount = 'Подходит только накопительный счёт'

  // Накопленное вручную — только у цели без счёта; пустое поле — ноль
  let currentAmount: MinorUnits | null = null
  if (draft.linkedAccountId === null) {
    const text = draft.currentAmountText.trim()
    const parsed = text === '' ? { ok: true as const, value: 0 } : Money.parse(text)
    if (!parsed.ok) errors.currentAmount = PARSE_ERROR_MESSAGES[parsed.error]
    else currentAmount = parsed.value
  }

  if (Object.keys(errors).length > 0 || !target.ok) return { ok: false, errors }
  return {
    ok: true,
    value: {
      name,
      icon,
      targetAmount: target.value,
      targetDate: targetDate === '' ? null : targetDate,
      linkedAccountId: account?.id ?? null,
      currentAmount,
    },
  }
}

export function draftFromGoal(goal: SavingsGoal | null): GoalDraft {
  if (!goal) {
    return { name: '', icon: DEFAULT_GOAL_ICON, targetAmountText: '', targetDate: '', linkedAccountId: null, currentAmountText: '' }
  }
  return {
    name: goal.name,
    icon: goal.icon,
    targetAmountText: Money.toInputString(goal.targetAmount),
    targetDate: goal.targetDate ?? '',
    linkedAccountId: goal.linkedAccountId ?? null,
    currentAmountText: goal.currentAmount ? Money.toInputString(goal.currentAmount) : '',
  }
}
