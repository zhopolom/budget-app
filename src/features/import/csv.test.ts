import { describe, expect, it } from 'vitest'
import { decodeCsvBytes, detectDelimiter, parseCsv, parseCsvFile, stripBom } from './csv'

describe('parseCsv', () => {
  it('делит строки и поля', () => {
    expect(parseCsv('a,b,c\n1,2,3', ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('понимает CRLF, LF и последний перевод строки', () => {
    expect(parseCsv('a,b\r\n1,2\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('a,b\n1,2\n\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('кавычки: разделители, переносы строк и удвоенные кавычки внутри поля', () => {
    expect(parseCsv('"АТБ, Хрещатик","строка\nвторая","он сказал ""привет"""\n', ',')).toEqual([
      ['АТБ, Хрещатик', 'строка\nвторая', 'он сказал "привет"'],
    ])
  })

  it('пустые поля и пустые строки', () => {
    expect(parseCsv('a,,c\n,,\n1,2,3', ',')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
      ['1', '2', '3'],
    ])
  })

  it('точка с запятой и табуляция', () => {
    expect(parseCsv('a;b\n1;2', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('кавычка внутри поля без кавычек остаётся символом', () => {
    expect(parseCsv('5" экран,2', ',')).toEqual([['5" экран', '2']])
  })
})

describe('detectDelimiter', () => {
  it('выбирает разделитель, при котором колонки сходятся', () => {
    expect(detectDelimiter('Дата;Сумма;Описание\n21.09.2026;-430,00;АТБ, Хрещатик\n')).toBe(';')
    expect(detectDelimiter('Date,Amount,Note\n2026-09-21,-4.30,"Uber, trip"\n')).toBe(',')
    expect(detectDelimiter('Date\tAmount\n2026-09-21\t-4.30\n')).toBe('\t')
  })

  it('без разделителей — запятая по умолчанию', () => {
    expect(detectDelimiter('одна колонка\nи ещё\n')).toBe(',')
    expect(detectDelimiter('')).toBe(',')
  })

  it('не путает запятые в кавычках с разделителем', () => {
    expect(detectDelimiter('Дата;Описание\n21.09.2026;"АТБ, Хрещатик, 12"\n')).toBe(';')
  })
})

describe('parseCsvFile', () => {
  it('снимает BOM, берёт заголовок и дополняет короткие строки', () => {
    const parsed = parseCsvFile('﻿Date,Amount,Note\n2026-09-21,-430\n2026-09-22,100,Зарплата\n')
    expect(parsed.delimiter).toBe(',')
    expect(parsed.header).toEqual(['Date', 'Amount', 'Note'])
    expect(parsed.records).toEqual([
      ['2026-09-21', '-430', ''],
      ['2026-09-22', '100', 'Зарплата'],
    ])
    expect(stripBom('﻿x')).toBe('x')
  })
})

describe('decodeCsvBytes', () => {
  it('читает UTF-8 как есть', () => {
    const bytes = new TextEncoder().encode('Дата,Сумма\n')
    expect(decodeCsvBytes(bytes.buffer as ArrayBuffer)).toEqual({ text: 'Дата,Сумма\n', encoding: 'utf-8' })
  })

  it('невалидный UTF-8 читает как windows-1251', () => {
    // «Дата» в windows-1251: C4 E0 F2 E0
    const bytes = new Uint8Array([0xc4, 0xe0, 0xf2, 0xe0, 0x2c, 0x31])
    const decoded = decodeCsvBytes(bytes.buffer as ArrayBuffer)
    expect(decoded.encoding).toBe('windows-1251')
    expect(decoded.text).toBe('Дата,1')
  })
})
