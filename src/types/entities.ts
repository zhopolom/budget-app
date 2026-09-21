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

/** Перевод не относится ни к доходам, ни к расходам — у него нет категории. */
export type TransactionType = 'expense' | 'income' | 'transfer'

/** Категории бывают только у расходов и доходов. */
export type CategoryType = 'expense' | 'income'

/** Тип операции, у которой есть категория и один счёт. */
export type EntryType = CategoryType

export interface Category {
  id: Id
  name: string
  /** Emoji. */
  icon: string
  type: CategoryType
  /** Системные категории создаются при первом запуске и не редактируются. */
  isSystem: boolean
  createdAt: Timestamp
}

interface TransactionBase {
  id: Id
  /** Всегда положительное значение; направление определяется полем type. */
  amount: MinorUnits
  date: IsoDate
  /** Пустая строка, если комментария нет. */
  note: string
  /**
   * Операция создана регулярным платежом. Вместе с occurrenceDate образует
   * уникальный индекс: повторный запуск приложения не создаёт дубль.
   */
  recurringId?: Id
  /** Плановая дата вхождения регулярной операции (не обязательно равна date). */
  occurrenceDate?: IsoDate
  createdAt: Timestamp
  updatedAt: Timestamp
}

/** Расход или доход: один счёт и обязательная категория. */
export interface EntryTransaction extends TransactionBase {
  type: EntryType
  accountId: Id
  categoryId: Id
}

/**
 * Перевод между своими счетами: уменьшает один счёт и увеличивает другой.
 * Общий капитал не меняется, в доходы/расходы и в бюджет не попадает.
 */
export interface TransferTransaction extends TransactionBase {
  type: 'transfer'
  fromAccountId: Id
  toAccountId: Id
}

/**
 * Размеченное объединение: TypeScript не даст прочитать categoryId у перевода
 * или fromAccountId у расхода, пока тип не сужен. Хелперы — в features/transactions/model.ts.
 */
export type Transaction = EntryTransaction | TransferTransaction

/** Задел v0.1: лимиты категорий хранились внутри Budget. С v2 живут в отдельной таблице. */
export interface LegacyCategoryLimit {
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
  /** @deprecated Осталось от v0.1, миграция v2 переносит значения в categoryBudgets. */
  categoryLimits?: LegacyCategoryLimit[]
}

/**
 * Лимит расходов по одной категории на конкретный месяц.
 * Работает дополнительно к общему месячному бюджету: сумма лимитов
 * не обязана совпадать с общим бюджетом.
 */
export interface CategoryBudget {
  /** Детерминированный id вида '2026-09:cat-exp-groceries'. */
  id: Id
  categoryId: Id
  /** 1–12 */
  month: number
  year: number
  limitAmount: MinorUnits
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly'

interface RecurringBase {
  id: Id
  amount: MinorUnits
  note: string
  frequency: RecurrenceFrequency
  /** Каждые N периодов, >= 1. */
  interval: number
  startDate: IsoDate
  /** Ближайшее ещё не созданное вхождение. Кэш поверх startDate + frequency. */
  nextOccurrence: IsoDate
  /** Включительно. Отсутствует — повторяется бессрочно. */
  endDate?: IsoDate
  isActive: boolean
  lastGeneratedAt?: Timestamp
  createdAt: Timestamp
  updatedAt: Timestamp
}

/** Регулярный расход или доход: аренда, подписка, зарплата. */
export interface RecurringEntry extends RecurringBase {
  type: EntryType
  accountId: Id
  categoryId: Id
}

/** Регулярный перевод: «каждый месяц 2000 ₴ с карты на накопительный». */
export interface RecurringTransfer extends RecurringBase {
  type: 'transfer'
  fromAccountId: Id
  toAccountId: Id
}

/**
 * Регулярная операция. Размечена так же, как Transaction: у перевода нет
 * категории, у расхода нет счетов перевода.
 *
 * Приложение без backend, поэтому операции создаются при запуске —
 * см. features/recurring/occurrences.ts.
 */
export type RecurringTransaction = RecurringEntry | RecurringTransfer

export type ThemePreference = 'system' | 'light' | 'dark'

export interface AppSettings {
  id: 'app'
  baseCurrency: CurrencyCode
  theme: ThemePreference
  /** Последний выбранный счёт — подставляется по умолчанию при добавлении операции. */
  lastAccountId: Id | null
}
