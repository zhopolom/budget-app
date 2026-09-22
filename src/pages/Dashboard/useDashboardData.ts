import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import { accountsRepository } from '../../features/accounts/repository'
import {
  buildCategoryBudgetProgress,
  calculateBudgetProgress,
  totalCategoryLimits,
  type BudgetProgress,
  type CategoryBudgetProgress,
} from '../../features/budgets/calculations'
import { budgetsRepository, categoryBudgetsRepository } from '../../features/budgets/repository'
import { categoriesRepository } from '../../features/categories/repository'
import {
  calculateForecast,
  listUpcoming,
  UPCOMING_DAYS,
  type Forecast,
  type UpcomingOccurrence,
} from '../../features/forecast/service'
import { pendingOccurrencesRepository, type PendingOccurrenceView } from '../../features/recurring/pending'
import { recurringRepository } from '../../features/recurring/repository'
import { settingsRepository } from '../../features/settings/repository'
import {
  calculateCategoryTotals,
  calculateTotalBalance,
  calculateTotals,
  type Totals,
} from '../../features/transactions/calculations'
import { transactionsRepository } from '../../features/transactions/repository'
import { toTransactionViews, type TransactionView } from '../../features/transactions/views'
import type { Account, Category, CurrencyCode, IsoDate, MinorUnits } from '../../types/entities'
import {
  addDaysIso,
  fromIsoDate,
  isSameYearMonth,
  monthDateRange,
  monthKey,
  yearMonthOf,
  type YearMonth,
} from '../../utils/dates'

const RECENT_LIMIT = 8
/** Сколько ближайших регулярных операций показывать на главной. */
const UPCOMING_LIMIT = 5

export interface DashboardData {
  month: YearMonth
  currency: CurrencyCode
  totalBalance: MinorUnits
  monthTotals: Totals
  budget: BudgetProgress | null
  categoryBudgets: CategoryBudgetProgress[]
  categoryLimitsTotal: MinorUnits
  recent: TransactionView[]
  /** Прогноз до конца месяца. null — выбран не текущий месяц: прогнозировать прошлое нечего. */
  forecast: Forecast | null
  /** Ближайшие регулярные операции; пусто для не текущего месяца. */
  upcoming: UpcomingOccurrence[]
  /** Вхождения, которые ждут подтверждения, — в любом месяце: решение нужно сейчас. */
  pending: PendingOccurrenceView[]
  accounts: Account[]
  categories: Category[]
}

async function loadDashboardData(month: YearMonth, today: IsoDate): Promise<DashboardData> {
  const todayDate = fromIsoDate(today)
  const { start, end } = monthDateRange(month)

  // Одна read-транзакция: все цифры считаются по согласованному снимку базы
  return db.transaction(
    'r',
    [
      db.settings,
      db.accounts,
      db.categories,
      db.transactions,
      db.budgets,
      db.categoryBudgets,
      db.recurringTransactions,
      db.pendingOccurrences,
    ],
    async () => {
      const [settings, accounts, categories, allTransactions, monthTransactions, recent, budget, limits, rules, pending] =
        await Promise.all([
          settingsRepository.get(),
          accountsRepository.listAll(),
          categoriesRepository.listAll(),
          // Общий баланс считается по всей истории — иначе он был бы неверным
          transactionsRepository.listAll(),
          transactionsRepository.listByDateRange(start, end),
          // Последние — из индекса [date+createdAt], без сортировки всей истории
          db.transactions.orderBy('[date+createdAt]').reverse().limit(RECENT_LIMIT).toArray(),
          budgetsRepository.getForMonth(month),
          categoryBudgetsRepository.listForMonth(month),
          recurringRepository.listAll(),
          pendingOccurrencesRepository.listPendingViews(),
        ])

      const monthTotals = calculateTotals(monthTransactions)
      const spentByCategory = calculateCategoryTotals(monthTransactions)
      // Прогноз и ближайшие операции — про «сейчас»: для прошлых и будущих месяцев их нет
      const isCurrentMonth = isSameYearMonth(month, yearMonthOf(today))

      return {
        month,
        currency: settings.baseCurrency,
        totalBalance: calculateTotalBalance(accounts, allTransactions),
        monthTotals,
        budget: budget ? calculateBudgetProgress(budget.totalLimit, monthTotals.expense, month, todayDate) : null,
        categoryBudgets: buildCategoryBudgetProgress(limits, spentByCategory, categories),
        categoryLimitsTotal: totalCategoryLimits(limits),
        recent: toTransactionViews(recent, categories, accounts),
        forecast: isCurrentMonth
          ? calculateForecast({
              today,
              accounts,
              transactions: allTransactions,
              rules,
              pending: pending.map((view) => view.occurrence),
              monthlyLimit: budget?.totalLimit ?? null,
            })
          : null,
        upcoming: isCurrentMonth ? listUpcoming(rules, today, addDaysIso(today, UPCOMING_DAYS), UPCOMING_LIMIT) : [],
        pending,
        accounts,
        categories,
      }
    },
  )
}

/** undefined — пока идёт первое чтение. Обновляется автоматически при любом изменении данных. */
export function useDashboardData(month: YearMonth, today: IsoDate): DashboardData | undefined {
  return useLiveQuery(() => loadDashboardData(month, today), [monthKey(month), today])
}
