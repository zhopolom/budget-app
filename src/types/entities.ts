/** Уникальный идентификатор сущности (UUID v4). */
export type Id = string

/**
 * Денежная сумма в минимальных единицах валюты (копейках).
 * Всегда целое число: 125,50 ₴ хранится как 12550.
 */
export type MinorUnits = number

/** Unix-время в миллисекундах. */
export type Timestamp = number

/** Календарная дата без времени в локальной зоне: 'yyyy-MM-dd'. */
export type IsoDate = string

export type CurrencyCode = 'UAH' | 'USD' | 'EUR' | 'PLN'

export type AccountType = 'card' | 'cash' | 'savings' | 'other'

export interface Account {
  id: Id
  name: string
  type: AccountType
  initialBalance: MinorUnits
  currency: CurrencyCode
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type TransactionType = 'expense' | 'income'
export type CategoryType = TransactionType

export interface Category {
  id: Id
  name: string
  /** Emoji. */
  icon: string
  type: CategoryType
  /** Системные категории создаются при первом запуске и в v0.1 не редактируются. */
  isSystem: boolean
  createdAt: Timestamp
}

export interface Transaction {
  id: Id
  type: TransactionType
  /** Всегда положительное значение; знак определяется полем type. */
  amount: MinorUnits
  categoryId: Id
  accountId: Id
  date: IsoDate
  /** Пустая строка, если комментария нет. */
  note: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

/** Задел на будущее: лимиты по категориям. В v0.1 интерфейса нет. */
export interface CategoryLimit {
  categoryId: Id
  limit: MinorUnits
}

export interface Budget {
  /** Детерминированный id вида '2026-09' — один бюджет на месяц. */
  id: Id
  /** 1–12 (не 0–11, как в Date). */
  month: number
  year: number
  totalLimit: MinorUnits
  categoryLimits?: CategoryLimit[]
}

export type ThemePreference = 'system' | 'light' | 'dark'

export interface AppSettings {
  id: 'app'
  baseCurrency: CurrencyCode
  theme: ThemePreference
  /** Последний выбранный счёт — подставляется по умолчанию при добавлении операции. */
  lastAccountId: Id | null
}
