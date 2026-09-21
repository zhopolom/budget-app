import { describe, expect, it } from 'vitest'
import type { Account, Category, Transaction } from '../../types/entities'
import { Money } from '../../utils/money'
import { transactionIcon, transactionTitle, TRANSFER_ICON } from './labels'
import { toTransactionViews } from './views'

const CARD: Account = {
  id: 'card',
  name: 'Карта',
  type: 'card',
  initialBalance: 0,
  currency: 'UAH',
  createdAt: 1,
  updatedAt: 1,
}

const CASH: Account = { ...CARD, id: 'cash', name: 'Наличные', type: 'cash' }

const GROCERIES: Category = {
  id: 'groceries',
  name: 'Продукты',
  icon: '🛒',
  type: 'expense',
  isSystem: true,
  createdAt: 1,
}

const transfer = (fromAccountId: string, toAccountId: string): Transaction => ({
  id: 't',
  type: 'transfer',
  amount: Money.fromMajor(1_000),
  fromAccountId,
  toAccountId,
  date: '2026-09-21',
  note: '',
  createdAt: 1,
  updatedAt: 1,
})

const viewOf = (transaction: Transaction) => toTransactionViews([transaction], [GROCERIES], [CARD, CASH])[0]

describe('transactionTitle', () => {
  it('у перевода показывает оба счёта', () => {
    expect(transactionTitle(viewOf(transfer('card', 'cash')))).toBe('Карта → Наличные')
  })

  it('перевод, у которого счета свели в один, не выглядит ошибкой', () => {
    expect(transactionTitle(viewOf(transfer('card', 'card')))).toBe('Перевод внутри счёта · Карта')
  })

  it('удалённый счёт называет прямо', () => {
    expect(transactionTitle(viewOf(transfer('ghost', 'ghost')))).toBe('Перевод внутри счёта · Удалённый счёт')
    expect(transactionTitle(viewOf(transfer('card', 'ghost')))).toBe('Карта → Удалённый счёт')
  })

  it('у расхода показывает категорию', () => {
    const expense: Transaction = {
      id: 'e',
      type: 'expense',
      amount: Money.fromMajor(430),
      categoryId: 'groceries',
      accountId: 'card',
      date: '2026-09-21',
      note: '',
      createdAt: 1,
      updatedAt: 1,
    }
    expect(transactionTitle(viewOf(expense))).toBe('Продукты')
    expect(transactionIcon(viewOf(expense))).toBe('🛒')
  })

  it('иконка перевода не зависит от счетов', () => {
    expect(transactionIcon(viewOf(transfer('card', 'card')))).toBe(TRANSFER_ICON)
  })
})
