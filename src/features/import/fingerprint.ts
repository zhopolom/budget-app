import type { Id, IsoDate, MinorUnits, TransactionType } from '../../types/entities'
import { normalizeDescription } from './normalize'

/**
 * Детерминированный отпечаток операции (ТЗ §51): дата, сумма, тип, счёт и
 * нормализованное описание. У CSV нет наших id, поэтому «та же операция» —
 * это совпадение отпечатка. Отпечаток — только сигнал: решение «пропустить
 * или импортировать всё равно» принимает пользователь.
 */

export interface FingerprintInput {
  date: IsoDate
  amount: MinorUnits
  type: TransactionType
  accountId: Id
  description: string
}

/** FNV-1a, 32 бита; две прогонки с разными семенами дают 64 бита — этого хватает, чтобы случайные совпадения не встречались. */
function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619) >>> 0
  }
  return hash
}

export function fingerprint(input: FingerprintInput): string {
  const key = [input.date, input.amount, input.type, input.accountId, normalizeDescription(input.description)].join('\u001f')
  return `${fnv1a(key, 2_166_136_261).toString(16).padStart(8, '0')}${fnv1a(key, 0x9e37_79b9).toString(16).padStart(8, '0')}`
}
