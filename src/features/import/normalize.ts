import type { IsoDate, MinorUnits } from '../../types/entities'
import { isValidIsoDate } from '../../utils/dates'
import { isMoneyAmount } from '../../utils/money'

/**
 * Нормализация полей CSV (ТЗ §47–§48, §57). Правило одно: не угадывать.
 * Формат даты определяется по всем строкам сразу, и если подходит больше
 * одного — выбирает пользователь. Сумма разбирается только когда разделители
 * читаются однозначно; всё остальное — ошибка строки, а не «примерно так».
 */

export type DateFormat = 'YYYY-MM-DD' | 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY'

export const DATE_FORMATS: readonly DateFormat[] = ['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY']

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  'YYYY-MM-DD': '2026-09-21',
  'DD.MM.YYYY': '21.09.2026',
  'DD/MM/YYYY': '21/09/2026',
  'MM/DD/YYYY': '09/21/2026',
}

const pad2 = (value: string) => value.padStart(2, '0')

/** Год, месяц, день из текста по формату; проверяется, что дата существует. */
export function parseDateWith(text: string, format: DateFormat): IsoDate | null {
  const value = text.trim()
  // Время после даты («21.09.2026 14:05») отбрасываем: в учёте только день
  const datePart = value.split(/[ T]/)[0] ?? ''
  let match: RegExpExecArray | null
  let year: string
  let month: string
  let day: string

  switch (format) {
    case 'YYYY-MM-DD':
      match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(datePart)
      if (!match) return null
      ;[, year, month, day] = match
      break
    case 'DD.MM.YYYY':
      match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(datePart)
      if (!match) return null
      ;[, day, month, year] = match
      break
    case 'DD/MM/YYYY':
      match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(datePart)
      if (!match) return null
      ;[, day, month, year] = match
      break
    case 'MM/DD/YYYY':
      match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(datePart)
      if (!match) return null
      ;[, month, day, year] = match
      break
  }

  const iso = `${year}-${pad2(month)}-${pad2(day)}`
  if (!isValidIsoDate(iso)) return null
  // Разумные границы: опечатка в году не должна уехать в 1026 или 2926
  if (iso < '1970-01-01' || iso > '2100-12-31') return null
  return iso
}

/**
 * Форматы, в которых читается больше половины непустых дат выборки — и все
 * они читаются одинаково хорошо. Один — формат известен; несколько
 * (03/04/2026) — спросить пользователя; ноль — колонка не дата.
 * Одна опечатка вроде «31.02.2026» формат не ломает: такая строка станет
 * ошибкой в превью, а не причиной отказа от всего файла.
 */
export function detectDateFormats(samples: readonly string[]): DateFormat[] {
  const values = samples.map((sample) => sample.trim()).filter((sample) => sample !== '')
  if (values.length === 0) return []

  const scores = DATE_FORMATS.map((format) => ({
    format,
    parsed: values.filter((value) => parseDateWith(value, format) !== null).length,
  }))
  const best = Math.max(...scores.map((score) => score.parsed))
  if (best * 2 <= values.length) return []
  return scores.filter((score) => score.parsed === best).map((score) => score.format)
}

export type AmountParse = { ok: true; value: MinorUnits } | { ok: false; reason: 'empty' | 'invalid' | 'tooLarge' }

/**
 * Сумма из текста в копейки, со знаком. Понимает 1234.56, 1234,56, 1 234,56,
 * 1,234.56, −1 234,56, (1234.56), «1 234,56 ₴», «UAH 12.30».
 *
 * Правило разделителей: если есть и запятая, и точка — десятичный тот, что
 * стоит последним, а другой обязан делить тысячи по три цифры. Если разделитель
 * один — он десятичный при одной–двух цифрах после него и тысячный при ровно
 * трёх; «1,234» — это тысяча двести тридцать четыре, потому что у денег не
 * бывает трёх знаков после запятой. Всё остальное — ошибка, а не догадка.
 */
export function parseAmount(text: string): AmountParse {
  let value = text.replace(/[\s  ]/g, '')
  if (value === '') return { ok: false, reason: 'empty' }

  let negative = false
  if (/^\(.*\)$/.test(value)) {
    negative = true
    value = value.slice(1, -1)
  }
  // Валюта и прочие буквы вокруг числа — не часть суммы
  value = value.replace(/[^\d.,+\-−]/g, '')
  if (/^[+\-−]/.test(value)) {
    if (value[0] !== '+') negative = !negative
    value = value.slice(1)
  }
  if (value === '' || /[+\-−]/.test(value)) return { ok: false, reason: 'invalid' }

  const split = splitDecimal(value)
  if (!split) return { ok: false, reason: 'invalid' }
  const [integer, fraction] = split

  const minor = Number(integer) * 100 + Number(fraction.padEnd(2, '0'))
  if (!isMoneyAmount(minor)) return { ok: false, reason: 'tooLarge' }
  return { ok: true, value: negative ? -minor : minor }
}

/** Целая и дробная части как строки цифр; null — разделители не читаются однозначно. */
function splitDecimal(value: string): [string, string] | null {
  const lastComma = value.lastIndexOf(',')
  const lastDot = value.lastIndexOf('.')

  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? ',' : '.'
    const thousands = decimal === ',' ? '.' : ','
    const [integerRaw, fraction, extra] = value.split(decimal)
    if (extra !== undefined || fraction === undefined || !/^\d{1,2}$/.test(fraction)) return null
    return groupsValid(integerRaw, thousands) ? [integerRaw.split(thousands).join(''), fraction] : null
  }

  const separator = lastComma !== -1 ? ',' : lastDot !== -1 ? '.' : null
  if (separator === null) return /^\d+$/.test(value) ? [value, ''] : null

  const parts = value.split(separator)
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) return [parts[0], parts[1]]
  // Один разделитель и ровно по три цифры после каждого — это группы тысяч
  return groupsValid(value, separator) ? [parts.join(''), ''] : null
}

/** «1», «1.234», «12.345.678» — группы тысяч по три цифры, первая — от одной до трёх. */
function groupsValid(integer: string, thousands: string): boolean {
  const groups = integer.split(thousands)
  if (!/^\d{1,3}$/.test(groups[0])) return false
  return groups.slice(1).every((group) => /^\d{3}$/.test(group))
}

/** trim, схлопывание пробелов, нижний регистр — для сопоставления правил и отпечатков (ТЗ §57). */
export function normalizeDescription(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru')
}
