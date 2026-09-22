/**
 * Разбор CSV (ТЗ §45): запятая, точка с запятой и табуляция с автоопределением,
 * поля в кавычках с запятыми, переносами строк и удвоенными кавычками внутри,
 * BOM, CRLF и LF.
 *
 * Свой парсер, а не зависимость: это конечный автомат на сотню строк, он
 * полностью покрыт тестами и не тянет в бандл лишних килобайт. Ошибки
 * формата здесь не «чинятся» — строка с незакрытой кавычкой дойдёт до конца
 * файла как одно поле, и превью это покажет.
 */

export type Delimiter = ',' | ';' | '\t'

export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t']

const BOM = '﻿'

export function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text
}

/** Разбирает текст на строки и поля. Пустые строки (в том числе последняя после перевода строки) пропускаются. */
export function parseCsv(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let fieldStarted = false

  const endField = () => {
    row.push(field)
    field = ''
    fieldStarted = false
  }
  const endRow = () => {
    endField()
    // Строка из одного пустого поля — это пустая строка файла, а не запись
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && !fieldStarted) {
      quoted = true
      fieldStarted = true
    } else if (char === delimiter) {
      endField()
    } else if (char === '\r') {
      // CRLF: перевод строки обработает следующий символ
      if (text[index + 1] !== '\n') endRow()
    } else if (char === '\n') {
      endRow()
    } else {
      field += char
      fieldStarted = true
    }
  }

  if (fieldStarted || row.length > 0) endRow()
  return rows
}

/**
 * Разделитель — тот, при котором первые строки делятся на одинаковое число
 * колонок, и колонок больше одной. При равенстве побеждает запятая.
 */
export function detectDelimiter(text: string, sampleLines = 20): Delimiter {
  const sample = stripBom(text).split(/\r?\n/).filter((line) => line.trim() !== '').slice(0, sampleLines).join('\n')
  if (sample === '') return ','

  let best: { delimiter: Delimiter; columns: number; consistent: boolean } = { delimiter: ',', columns: 1, consistent: true }
  for (const delimiter of DELIMITERS) {
    const rows = parseCsv(sample, delimiter)
    if (rows.length === 0) continue
    const columns = rows[0].length
    const consistent = rows.every((row) => row.length === columns)
    const better =
      columns > 1 &&
      ((consistent && !best.consistent) || (consistent === best.consistent && columns > best.columns))
    if (better) best = { delimiter, columns, consistent }
  }
  return best.delimiter
}

export interface ParsedCsv {
  delimiter: Delimiter
  /** Первая строка файла — названия колонок. */
  header: string[]
  /** Остальные строки; короткие строки дополняются пустыми полями до ширины заголовка. */
  records: string[][]
}

export function parseCsvFile(text: string, delimiter?: Delimiter): ParsedCsv {
  const clean = stripBom(text)
  const chosen = delimiter ?? detectDelimiter(clean)
  const rows = parseCsv(clean, chosen)
  const header = (rows[0] ?? []).map((cell) => cell.trim())
  const records = rows.slice(1).map((row) => {
    if (row.length >= header.length) return row
    return [...row, ...Array.from({ length: header.length - row.length }, () => '')]
  })
  return { delimiter: chosen, header, records }
}

export type CsvEncoding = 'utf-8' | 'windows-1251'

export interface DecodedCsv {
  text: string
  encoding: CsvEncoding
}

/**
 * Проверка кодировки (ТЗ §44): файл читается как UTF-8 в строгом режиме;
 * если байты не складываются в UTF-8 — это почти наверняка выгрузка
 * банка в windows-1251, читаем так. Молча «чинить» кракозябры нельзя,
 * поэтому кодировка возвращается и показывается в мастере.
 */
export function decodeCsvBytes(bytes: ArrayBuffer): DecodedCsv {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    try {
      return { text: new TextDecoder('windows-1251').decode(bytes), encoding: 'windows-1251' }
    } catch {
      return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' }
    }
  }
}
