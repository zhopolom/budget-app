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

/**
 * Перевод не относится ни к доходам, ни к расходам — у него нет категории.
 * Корректировка — результат сверки с фактическим остатком: меняет счёт,
 * но не является ни доходом, ни расходом и в бюджет не попадает.
 */
export type TransactionType = 'expense' | 'income' | 'transfer' | 'adjustment'

/** То, что вводят руками в форме: корректировку создаёт только сверка остатка. */
export type ManualTransactionType = 'expense' | 'income' | 'transfer'

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

/** Куда сверка сдвигает остаток: в банке оказалось больше или меньше, чем в Budget. */
export type AdjustmentDirection = 'increase' | 'decrease'

/**
 * Корректировка остатка по итогам сверки. Сумма всегда положительная,
 * направление — отдельным полем, как и у остальных типов: знак задаёт тип.
 * Влияет только на остаток счёта и общий капитал; в доходы, расходы,
 * бюджет и аналитику не попадает.
 */
export interface AdjustmentTransaction extends TransactionBase {
  type: 'adjustment'
  accountId: Id
  direction: AdjustmentDirection
}

/**
 * Размеченное объединение: TypeScript не даст прочитать categoryId у перевода
 * или fromAccountId у расхода, пока тип не сужен. Хелперы — в features/transactions/model.ts.
 */
export type Transaction = EntryTransaction | TransferTransaction | AdjustmentTransaction

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
  /**
   * Переносить неизрасходованный остаток на следующий месяц (0.5). Отсутствует —
   * нет. Сам перенос не хранится: он считается из лимита и трат прошлого месяца.
   */
  rollover?: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

/**
 * Цель накопления (0.5). Прогресс не хранится, если его можно посчитать:
 * у цели со счётом это остаток счёта, и только у цели без счёта — currentAmount.
 */
export interface SavingsGoal {
  id: Id
  name: string
  /** Эмодзи. */
  icon: string
  targetAmount: MinorUnits
  /** Накоплено вручную. Только у цели без счёта. */
  currentAmount?: MinorUnits
  /** Срок, включительно. Отсутствует — без срока. */
  targetDate?: IsoDate
  /** Накопительный счёт, остаток которого и есть прогресс. */
  linkedAccountId?: Id
  isArchived: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface BudgetTemplateLimit {
  categoryId: Id
  limitAmount: MinorUnits
}

/** Шаблон бюджета (0.5): общий лимит и лимиты категорий, которые применяются к месяцу. */
export interface BudgetTemplate {
  id: Id
  name: string
  /** 0 — общий лимит шаблон не задаёт. */
  totalLimit: MinorUnits
  categoryLimits: BudgetTemplateLimit[]
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly'

/**
 * Как расписание срабатывает в день срока (0.4):
 * automatic — операция создаётся сама, как было всегда;
 * confirm — создаётся ожидающее вхождение, а операция — только после подтверждения.
 */
export type RecurringExecutionMode = 'automatic' | 'confirm'

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
  /** Миграция v4 проставляет automatic всем правилам, созданным до 0.4. */
  executionMode: RecurringExecutionMode
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

export type PendingOccurrenceStatus = 'pending' | 'confirmed' | 'skipped'

/**
 * Вхождение расписания в режиме confirm (0.4). Не операция и не притворяется ею:
 * в остаток и историю попадает только после подтверждения.
 *
 * Подтверждённые и пропущенные записи остаются: по паре [recurringId+scheduledDate]
 * генерация узнаёт, что этот день уже разобран, и не создаёт его снова.
 */
export interface PendingOccurrence {
  id: Id
  recurringId: Id
  scheduledDate: IsoDate
  status: PendingOccurrenceStatus
  /** Операция, созданная подтверждением. Только у confirmed. */
  transactionId?: Id
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type ThemePreference = 'system' | 'light' | 'dark'

export interface AppSettings {
  id: 'app'
  baseCurrency: CurrencyCode
  theme: ThemePreference
  /** Последний выбранный счёт — подставляется по умолчанию при добавлении операции. */
  lastAccountId: Id | null
  /** Когда в последний раз сохраняли резервную копию. null — ни разу. */
  lastBackupAt: number | null
  /** До какого момента напоминание о копии отложено кнопкой «Позже». */
  backupReminderSnoozedUntil: number | null
}
