import { describe, expect, it } from 'vitest'
import { detectDateFormats, normalizeDescription, parseAmount, parseDateWith } from './normalize'

describe('parseDateWith', () => {
  it('читает четыре формата и отбрасывает время', () => {
    expect(parseDateWith('2026-09-21', 'YYYY-MM-DD')).toBe('2026-09-21')
    expect(parseDateWith('21.09.2026', 'DD.MM.YYYY')).toBe('2026-09-21')
    expect(parseDateWith('21/09/2026', 'DD/MM/YYYY')).toBe('2026-09-21')
    expect(parseDateWith('09/21/2026', 'MM/DD/YYYY')).toBe('2026-09-21')
    expect(parseDateWith('21.09.2026 14:05', 'DD.MM.YYYY')).toBe('2026-09-21')
    expect(parseDateWith('1.9.2026', 'DD.MM.YYYY')).toBe('2026-09-01')
  })

  it('несуществующие даты и опечатки в году не проходят', () => {
    expect(parseDateWith('31.02.2026', 'DD.MM.YYYY')).toBeNull()
    expect(parseDateWith('21.09.1026', 'DD.MM.YYYY')).toBeNull()
    expect(parseDateWith('2026-09-21', 'DD.MM.YYYY')).toBeNull()
    expect(parseDateWith('', 'YYYY-MM-DD')).toBeNull()
  })
})

describe('detectDateFormats', () => {
  it('однозначный формат находится по выборке', () => {
    expect(detectDateFormats(['21.09.2026', '01.10.2026'])).toEqual(['DD.MM.YYYY'])
    expect(detectDateFormats(['2026-09-21'])).toEqual(['YYYY-MM-DD'])
    expect(detectDateFormats(['21/09/2026', '30/09/2026'])).toEqual(['DD/MM/YYYY'])
  })

  it('«03/04/2026» неоднозначна — оба формата, решает пользователь', () => {
    expect(detectDateFormats(['03/04/2026', '05/06/2026'])).toEqual(['DD/MM/YYYY', 'MM/DD/YYYY'])
  })

  it('колонка не дата — пусто; пустые значения не мешают', () => {
    expect(detectDateFormats(['АТБ', '21.09.2026'])).toEqual([])
    expect(detectDateFormats(['', '21.09.2026', ''])).toEqual(['DD.MM.YYYY'])
    expect(detectDateFormats([])).toEqual([])
  })
})

describe('parseAmount', () => {
  it('разбирает форматы из ТЗ §48 в копейки', () => {
    expect(parseAmount('1234.56')).toEqual({ ok: true, value: 123_456 })
    expect(parseAmount('1234,56')).toEqual({ ok: true, value: 123_456 })
    expect(parseAmount('1 234,56')).toEqual({ ok: true, value: 123_456 })
    expect(parseAmount('1,234.56')).toEqual({ ok: true, value: 123_456 })
    expect(parseAmount('1.234,56')).toEqual({ ok: true, value: 123_456 })
    expect(parseAmount('1234')).toEqual({ ok: true, value: 123_400 })
    expect(parseAmount('12,5')).toEqual({ ok: true, value: 1_250 })
  })

  it('знак: минус, длинное тире, плюс и скобки', () => {
    expect(parseAmount('-430')).toEqual({ ok: true, value: -43_000 })
    expect(parseAmount('−430,00')).toEqual({ ok: true, value: -43_000 })
    expect(parseAmount('+430')).toEqual({ ok: true, value: 43_000 })
    expect(parseAmount('(430.00)')).toEqual({ ok: true, value: -43_000 })
  })

  it('валюта вокруг числа не мешает', () => {
    expect(parseAmount('1 234,56 ₴')).toEqual({ ok: true, value: 123_456 })
    expect(parseAmount('UAH 12.30')).toEqual({ ok: true, value: 1_230 })
    expect(parseAmount('$-5.00')).toEqual({ ok: true, value: -500 })
  })

  it('один разделитель и три цифры после него — тысячи, а не копейки', () => {
    expect(parseAmount('1,234')).toEqual({ ok: true, value: 123_400 })
    expect(parseAmount('12.345.678')).toEqual({ ok: true, value: 1_234_567_800 })
  })

  it('неоднозначное или испорченное не угадывается', () => {
    expect(parseAmount('1,2345')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseAmount('12,34,56')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseAmount('1.234,5.6')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseAmount('abc')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseAmount('--5')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseAmount('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseAmount('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('суммы за пределами политики Money не проходят', () => {
    expect(parseAmount('1000000000')).toEqual({ ok: false, reason: 'tooLarge' })
    expect(parseAmount('999999999.99')).toEqual({ ok: true, value: 99_999_999_999 })
  })
})

describe('normalizeDescription', () => {
  it('убирает лишние пробелы и регистр', () => {
    expect(normalizeDescription('  ATB   Market ')).toBe('atb market')
    expect(normalizeDescription('UBER\tTRIP\n123')).toBe('uber trip 123')
    expect(normalizeDescription('Spotify')).toBe(normalizeDescription('SPOTIFY'))
  })
})
