import type { Account, AccountType } from '../../types/entities'
import type { ValidationResult } from '../../types/validation'
import { Money, PARSE_ERROR_MESSAGES } from '../../utils/money'

export const ACCOUNT_NAME_MAX_LENGTH = 30

export type AccountInput = Pick<Account, 'name' | 'type' | 'initialBalance'>

export interface AccountDraft {
  name: string
  type: AccountType
  initialBalanceText: string
}

export type AccountField = 'name' | 'initialBalance'

export function validateAccountDraft(draft: AccountDraft): ValidationResult<AccountInput, AccountField> {
  const errors: Partial<Record<AccountField, string>> = {}

  const name = draft.name.trim()
  if (name === '') errors.name = 'Введите название'
  else if (name.length > ACCOUNT_NAME_MAX_LENGTH) errors.name = `Не длиннее ${ACCOUNT_NAME_MAX_LENGTH} символов`

  // Пустое поле — это ноль. Отрицательный начальный остаток в v0.1 не поддерживается
  const parsed = draft.initialBalanceText.trim() === '' ? { ok: true as const, value: 0 } : Money.parse(draft.initialBalanceText)
  if (!parsed.ok) errors.initialBalance = PARSE_ERROR_MESSAGES[parsed.error]

  if (Object.keys(errors).length > 0 || !parsed.ok) return { ok: false, errors }
  return { ok: true, value: { name, type: draft.type, initialBalance: parsed.value } }
}

export function draftFromAccount(account: Account | null): AccountDraft {
  if (!account) return { name: '', type: 'card', initialBalanceText: '' }
  return {
    name: account.name,
    type: account.type,
    initialBalanceText: account.initialBalance === 0 ? '' : Money.toInputString(account.initialBalance),
  }
}
