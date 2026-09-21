import { describe, expect, it } from 'vitest'
import type { Account, Category } from '../../types/entities'
import { Money } from '../../utils/money'
import { draftFromTransaction, emptyDraft, validateTransactionDraft, type TransactionDraft } from './validation'

const account = (id: string, currency: Account['currency'] = 'UAH'): Account => ({
  id,
  name: id,
  type: 'card',
  initialBalance: 0,
  currency,
  createdAt: 1,
  updatedAt: 1,
})

const category = (id: string, type: Category['type']): Category => ({
  id,
  name: id,
  icon: '🛒',
  type,
  isSystem: true,
  createdAt: 1,
})

const CONTEXT = {
  accounts: [account('card'), account('cash'), account('usd', 'USD')],
  categories: [category('groceries', 'expense'), category('salary', 'income')],
}

const draft = (patch: Partial<TransactionDraft>): TransactionDraft => ({
  ...emptyDraft('card', '2026-09-21'),
  ...patch,
})

describe('расход и доход', () => {
  it('принимает корректный расход и переводит сумму в копейки', () => {
    const result = validateTransactionDraft(
      draft({ type: 'expense', amountText: '430,50', categoryId: 'groceries', accountId: 'card', note: '  АТБ  ' }),
      CONTEXT,
    )

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'expense',
        amount: 43_050,
        categoryId: 'groceries',
        accountId: 'card',
        date: '2026-09-21',
        note: 'АТБ',
      },
    })
  })

  it('требует категорию нужного типа', () => {
    const result = validateTransactionDraft(
      draft({ type: 'income', amountText: '100', categoryId: 'groceries', accountId: 'card' }),
      CONTEXT,
    )
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors.category).toBeDefined()
  })

  it('требует существующий счёт', () => {
    const result = validateTransactionDraft(
      draft({ amountText: '100', categoryId: 'groceries', accountId: 'ghost' }),
      CONTEXT,
    )
    expect(result.ok === false && result.errors.account).toBeDefined()
  })

  it('не принимает пустую и нулевую сумму', () => {
    expect(validateTransactionDraft(draft({ amountText: '', categoryId: 'groceries' }), CONTEXT).ok).toBe(false)
    expect(validateTransactionDraft(draft({ amountText: '0', categoryId: 'groceries' }), CONTEXT).ok).toBe(false)
  })
})

describe('перевод', () => {
  const transferDraft = (patch: Partial<TransactionDraft> = {}) =>
    draft({ type: 'transfer', amountText: '500', fromAccountId: 'card', toAccountId: 'cash', ...patch })

  it('принимает корректный перевод и не требует категорию', () => {
    const result = validateTransactionDraft(transferDraft(), CONTEXT)

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'transfer',
        amount: Money.fromMajor(500),
        fromAccountId: 'card',
        toAccountId: 'cash',
        date: '2026-09-21',
        note: '',
      },
    })
  })

  it('не даёт перевести счёт сам на себя', () => {
    const result = validateTransactionDraft(transferDraft({ toAccountId: 'card' }), CONTEXT)
    expect(result.ok === false && result.errors.toAccount).toBe('Выберите другой счёт')
  })

  it('не даёт перевести между разными валютами', () => {
    const result = validateTransactionDraft(transferDraft({ toAccountId: 'usd' }), CONTEXT)
    expect(result.ok === false && result.errors.toAccount).toBe('Счета в разных валютах')
  })

  it('требует оба счёта', () => {
    const result = validateTransactionDraft(transferDraft({ fromAccountId: null, toAccountId: null }), CONTEXT)
    expect(result.ok === false && result.errors.fromAccount).toBeDefined()
    expect(result.ok === false && result.errors.toAccount).toBeDefined()
  })

  it('игнорирует категорию, оставшуюся от расхода', () => {
    const result = validateTransactionDraft(transferDraft({ categoryId: 'groceries' }), CONTEXT)
    expect(result.ok).toBe(true)
    expect(result.ok && 'categoryId' in result.value).toBe(false)
  })
})

describe('draftFromTransaction', () => {
  it('раскладывает перевод обратно в поля формы', () => {
    const result = draftFromTransaction({
      id: 't1',
      type: 'transfer',
      amount: Money.fromMajor(500),
      fromAccountId: 'card',
      toAccountId: 'cash',
      date: '2026-09-10',
      note: 'Банкомат',
      createdAt: 1,
      updatedAt: 1,
    })

    expect(result).toEqual({
      type: 'transfer',
      amountText: '500',
      categoryId: null,
      accountId: null,
      fromAccountId: 'card',
      toAccountId: 'cash',
      date: '2026-09-10',
      note: 'Банкомат',
    })
  })

  it('раскладывает расход обратно в поля формы', () => {
    const result = draftFromTransaction({
      id: 'e1',
      type: 'expense',
      amount: 43_050,
      categoryId: 'groceries',
      accountId: 'card',
      date: '2026-09-10',
      note: '',
      createdAt: 1,
      updatedAt: 1,
    })

    expect(result).toMatchObject({
      type: 'expense',
      amountText: '430,50',
      categoryId: 'groceries',
      accountId: 'card',
      fromAccountId: null,
      toAccountId: null,
    })
  })
})
