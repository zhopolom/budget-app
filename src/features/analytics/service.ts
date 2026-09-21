import type { Category, Id, IsoDate, MinorUnits, Transaction } from '../../types/entities'
import { daysInMonth, isSameYearMonth, monthDays, yearMonthOf, type YearMonth } from '../../utils/dates'
import { Money } from '../../utils/money'
import { calculateCategoryTotals, calculateTotals, type Totals } from '../transactions/calculations'
import { isTransfer } from '../transactions/model'
import type { TransactionView } from '../transactions/views'

/**
 * Слой аналитики: чистые функции над уже прочитанными операциями.
 * Экран только рисует то, что здесь посчитано, — цифры можно проверить тестами.
 */

export interface DailyExpensePoint {
  date: IsoDate
  /** Число месяца — подпись по оси X. */
  day: number
  expense: MinorUnits
}

export interface CategoryShare {
  categoryId: Id
  /** undefined, если категорию удалили. */
  category: Category | undefined
  amount: MinorUnits
  /** Доля от расходов периода, целые проценты. */
  percent: number
}

export interface MonthComparison {
  current: MinorUnits
  previous: MinorUnits
  /** current − previous. */
  delta: MinorUnits
  /**
   * Изменение в процентах с одним знаком после запятой.
   * null — в прошлом месяце расходов не было, считать не от чего.
   */
  deltaPercent: number | null
}

export interface MonthAnalytics {
  month: YearMonth
  totals: Totals
  dailyExpenses: DailyExpensePoint[]
  topCategories: CategoryShare[]
  comparison: MonthComparison
  /** Средний расход за день: в текущем месяце — за прошедшие дни, иначе за весь месяц. */
  averageDailyExpense: MinorUnits
  /** Дней, в которые были траты. */
  daysWithExpenses: number
  largestExpense: TransactionView | null
  transactionCount: number
}

/** Расходы по каждому дню месяца, включая дни без трат: у графика не должно быть дыр. */
export function buildDailyExpenses(month: YearMonth, transactions: readonly Transaction[]): DailyExpensePoint[] {
  const totals = new Map<IsoDate, MinorUnits>()
  for (const transaction of transactions) {
    if (isTransfer(transaction) || transaction.type !== 'expense') continue
    totals.set(transaction.date, Money.add(totals.get(transaction.date) ?? 0, transaction.amount))
  }

  return monthDays(month).map((date) => ({
    date,
    day: Number(date.slice(8)),
    expense: totals.get(date) ?? 0,
  }))
}

/**
 * Категории по убыванию расхода. Проценты считаются от расходов периода,
 * поэтому в сумме дают 100 (± округление), а не долю от бюджета.
 */
export function buildCategoryShares(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  limit?: number,
): CategoryShare[] {
  const totals = calculateCategoryTotals(transactions)
  const totalExpense = Money.sum(totals.values())
  const categoryById = new Map(categories.map((category) => [category.id, category]))

  const shares = [...totals.entries()]
    .map(([categoryId, amount]) => ({
      categoryId,
      category: categoryById.get(categoryId),
      amount,
      percent: Money.percentOf(amount, totalExpense),
    }))
    .sort((a, b) => b.amount - a.amount)

  return limit === undefined ? shares : shares.slice(0, limit)
}

export function compareMonths(current: MinorUnits, previous: MinorUnits): MonthComparison {
  const delta = Money.subtract(current, previous)
  return {
    current,
    previous,
    delta,
    // От нуля процент не считается: «выросло на бесконечность» ничего не сообщает
    deltaPercent: previous === 0 ? null : Math.round((delta / previous) * 1000) / 10,
  }
}

/**
 * Средний расход за день. Для текущего месяца делим на прошедшие дни:
 * 21-го числа делить месячную сумму на 30 значит занижать её на треть.
 */
export function averageDailyExpense(month: YearMonth, expense: MinorUnits, today: IsoDate): MinorUnits {
  const elapsed = isSameYearMonth(yearMonthOf(today), month) ? Number(today.slice(8)) : daysInMonth(month)
  if (elapsed <= 0) return 0
  // Округляем до целых гривен: у среднего копейки создают ложную точность
  return Math.round(expense / elapsed / 100) * 100
}

/** Самая крупная трата периода. Переводы и доходы не считаются. */
export function findLargestExpense(views: readonly TransactionView[]): TransactionView | null {
  let largest: TransactionView | null = null
  for (const view of views) {
    const { transaction } = view
    if (isTransfer(transaction) || transaction.type !== 'expense') continue
    if (!largest || transaction.amount > largest.transaction.amount) largest = view
  }
  return largest
}

export interface AnalyticsInput {
  month: YearMonth
  today: IsoDate
  views: readonly TransactionView[]
  /** Расходы предыдущего месяца — для сравнения. */
  previousExpense: MinorUnits
  categories: readonly Category[]
  topCategoriesLimit?: number
}

export function buildMonthAnalytics({
  month,
  today,
  views,
  previousExpense,
  categories,
  topCategoriesLimit = 5,
}: AnalyticsInput): MonthAnalytics {
  const transactions = views.map((view) => view.transaction)
  const totals = calculateTotals(transactions)
  const dailyExpenses = buildDailyExpenses(month, transactions)

  return {
    month,
    totals,
    dailyExpenses,
    topCategories: buildCategoryShares(transactions, categories, topCategoriesLimit),
    comparison: compareMonths(totals.expense, previousExpense),
    averageDailyExpense: averageDailyExpense(month, totals.expense, today),
    daysWithExpenses: dailyExpenses.filter((point) => point.expense > 0).length,
    largestExpense: findLargestExpense(views),
    transactionCount: transactions.length,
  }
}
