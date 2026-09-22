import type { CurrencyCode, TransactionSource } from '../../types/entities'
import { signedAmount } from '../transactions/calculations'
import { TRANSACTION_TYPE_LABELS } from '../transactions/labels'
import { isTransfer, transactionSourceOf } from '../transactions/model'
import type { TransactionView } from '../transactions/views'

/** Порядок колонок из ТЗ §23; Source добавлен в 0.6 последним, чтобы старые таблицы не поехали. */
export const CSV_HEADER = [
  'Date',
  'Type',
  'Amount',
  'Currency',
  'Category',
  'Account',
  'From Account',
  'To Account',
  'Note',
  'Source',
] as const

const SOURCE_LABELS: Record<TransactionSource, string> = {
  manual: 'Вручную',
  recurring: 'Регулярная',
  csv: 'Импорт CSV',
  adjustment: 'Сверка',
}

/**
 * Экранирование по RFC 4180: поле берётся в кавычки, если содержит
 * разделитель, кавычку или перенос строки; внутренние кавычки удваиваются.
 */
export function escapeCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

/** Сумма как десятичное число с точкой: таблицы ждут машинный формат, а не «1 250,50 ₴». */
function amountField(minorUnits: number): string {
  const sign = minorUnits < 0 ? '-' : ''
  const abs = Math.abs(minorUnits)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

function rowOf(view: TransactionView, currency: CurrencyCode): string[] {
  const { transaction } = view

  if (isTransfer(transaction)) {
    return [
      transaction.date,
      TRANSACTION_TYPE_LABELS.transfer,
      amountField(transaction.amount),
      currency,
      '',
      '',
      view.fromAccount?.name ?? '',
      view.toAccount?.name ?? '',
      transaction.note,
      SOURCE_LABELS[transactionSourceOf(transaction)],
    ]
  }

  // Расход выгружается со знаком минус, корректировка — по направлению:
  // так их видно в сводной таблице
  return [
    transaction.date,
    TRANSACTION_TYPE_LABELS[transaction.type],
    amountField(signedAmount(transaction)),
    currency,
    view.category?.name ?? '',
    view.account?.name ?? '',
    '',
    '',
    transaction.note,
    SOURCE_LABELS[transactionSourceOf(transaction)],
  ]
}

/**
 * CSV с операциями. Разделитель строк — CRLF, как требует RFC 4180
 * (и как ждут Excel и Numbers).
 */
export function toCsv(views: readonly TransactionView[], currency: CurrencyCode): string {
  const lines = [CSV_HEADER.join(',')]
  for (const view of views) {
    lines.push(rowOf(view, currency).map(escapeCsvField).join(','))
  }
  return lines.join('\r\n')
}

/**
 * BOM перед содержимым: без него Excel открывает UTF-8 как windows-1251
 * и кириллица превращается в кракозябры.
 */
export const UTF8_BOM = '﻿'
