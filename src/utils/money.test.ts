import { describe, expect, it } from 'vitest'
import { isMoneyAmount, isNonNegativeMoneyAmount, isPositiveMoneyAmount, MAX_AMOUNT, Money } from './money'

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

describe('Money.formatCompact', () => {
  it('прячет копейки и символ валюты — сумма должна влезать в ячейку календаря', () => {
    expect(Money.formatCompact(43_000)).toBe('430')
    expect(Money.formatCompact(43_050)).toBe('431')
    expect(Money.formatCompact(250_000)).toBe('2 500')
  })

  it('тысячи от десяти сокращает', () => {
    expect(Money.formatCompact(1_000_000)).toBe('10к')
    expect(Money.formatCompact(3_200_000)).toBe('32к')
    expect(Money.formatCompact(150_000_000)).toBe('1 500к')
  })

  it('знак не показывает: направление задаёт сам экран', () => {
    expect(Money.formatCompact(-43_000)).toBe('430')
  })
})

describe('политика денежных значений', () => {
  const unrepresentable = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, '100', null, undefined]
  const unsafe = [Number.MAX_SAFE_INTEGER + 1, 2 ** 53, MAX_AMOUNT + 1, -(MAX_AMOUNT + 1)]

  it.each([...unrepresentable, ...unsafe])('%s — не денежное значение', (value) => {
    expect(isMoneyAmount(value)).toBe(false)
    expect(isNonNegativeMoneyAmount(value)).toBe(false)
    expect(isPositiveMoneyAmount(value)).toBe(false)
  })

  it('границы: ноль, минус и MAX_AMOUNT', () => {
    expect(isMoneyAmount(0)).toBe(true)
    expect(isMoneyAmount(-1)).toBe(true)
    expect(isMoneyAmount(MAX_AMOUNT)).toBe(true)
    expect(isMoneyAmount(-MAX_AMOUNT)).toBe(true)

    expect(isNonNegativeMoneyAmount(0)).toBe(true)
    expect(isNonNegativeMoneyAmount(-1)).toBe(false)
    expect(isNonNegativeMoneyAmount(MAX_AMOUNT)).toBe(true)

    expect(isPositiveMoneyAmount(0)).toBe(false)
    expect(isPositiveMoneyAmount(1)).toBe(true)
    expect(isPositiveMoneyAmount(MAX_AMOUNT)).toBe(true)
  })

  it('парсер ввода и политика хранения согласны о верхней границе', () => {
    expect(Money.parse('999999999,99')).toEqual({ ok: true, value: MAX_AMOUNT })
    expect(isPositiveMoneyAmount(MAX_AMOUNT)).toBe(true)
  })
})
