import { describe, expect, it } from 'vitest'
import { Money } from './money'

const plain = (text: string) => text.replace(/\u00A0/g, ' ').replace(/\u2212/g, '-')

describe('Money.parse', () => {
  it.each([
    ['125,50', 12550],
    ['125.5', 12550],
    ['1 250', 125000],
    ['0.29', 29],
    ['12.', 1200],
    ['999999999,99', 99_999_999_999],
  ])('%s → %i копеек', (input, expected) => {
    expect(Money.parse(input)).toEqual({ ok: true, value: expected })
  })

  it.each([
    ['', 'empty'],
    ['-5', 'invalid'],
    ['1,234', 'invalid'],
    ['1000000000', 'tooLarge'],
  ])('%s → ошибка %s', (input, error) => {
    expect(Money.parse(input)).toEqual({ ok: false, error })
  })
})

describe('Money.format', () => {
  it('группирует разряды и не показывает нулевые копейки', () => {
    expect(plain(Money.format(125000, 'UAH'))).toBe('1 250 ₴')
    expect(plain(Money.format(12550, 'UAH'))).toBe('125,50 ₴')
    expect(plain(Money.format(5, 'UAH'))).toBe('0,05 ₴')
  })

  it('ставит знак для доходов и расходов', () => {
    expect(plain(Money.format(125000, 'UAH', { sign: 'always' }))).toBe('+1 250 ₴')
    expect(plain(Money.format(-125000, 'UAH', { sign: 'always' }))).toBe('-1 250 ₴')
    expect(plain(Money.format(0, 'UAH', { sign: 'always' }))).toBe('0 ₴')
  })
})

describe('Money.sanitizeInput', () => {
  it.each([
    ['430.505', '430,50'],
    ['0012', '12'],
    [',5', '0,5'],
    ['1,2,3', '1,23'],
    ['1234567890', '123456789'],
  ])('%s → %s', (input, expected) => {
    expect(Money.sanitizeInput(input)).toBe(expected)
  })
})
