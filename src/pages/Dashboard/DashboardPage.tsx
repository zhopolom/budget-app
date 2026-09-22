import { navigate } from '../../app/navigation'
import { useSelectedMonth } from '../../app/selectedMonth'
import { MonthSelector } from '../../components/MonthSelector/MonthSelector'
import { useToday } from '../../hooks/useToday'
import { formatMonthGenitive } from '../../utils/dates'
import { BackupReminderBanner } from './BackupReminderBanner'
import { BalanceSummary } from './BalanceSummary'
import { BudgetCard } from './BudgetCard'
import { CategoryBudgets } from './CategoryBudgets'
import styles from './DashboardPage.module.css'
import { ForecastCard } from './ForecastCard'
import { PendingCard } from './PendingCard'
import { RecentTransactions } from './RecentTransactions'
import { RecoveredAccountBanner } from './RecoveredAccountBanner'
import { UpcomingCard } from './UpcomingCard'
import { useDashboardData } from './useDashboardData'

export function DashboardPage() {
  const today = useToday()
  const selection = useSelectedMonth(today)
  const data = useDashboardData(selection.month, today)

  return (
    <div className={styles.page}>
      <MonthSelector selection={selection} />

      <RecoveredAccountBanner />
      <BackupReminderBanner />

      {data ? (
        <>
          <BalanceSummary totalBalance={data.totalBalance} monthTotals={data.monthTotals} currency={data.currency} />
          {data.pending.length > 0 && (
            <PendingCard
              items={data.pending}
              categories={data.categories}
              accounts={data.accounts}
              currency={data.currency}
              today={today}
            />
          )}
          {/* Карточка появляется, когда до конца месяца есть что ждать; без расписаний прогноз равен балансу */}
          {data.forecast && data.forecast.scheduledCount > 0 && (
            <ForecastCard
              forecast={data.forecast}
              monthGenitive={formatMonthGenitive(selection.month)}
              currency={data.currency}
            />
          )}
          <BudgetCard
            progress={data.budget}
            monthGenitive={formatMonthGenitive(selection.month)}
            currency={data.currency}
            guidance={data.forecast?.guidance ?? null}
            onSetup={() => navigate('/budgets')}
          />
          <CategoryBudgets items={data.categoryBudgets} currency={data.currency} />
          {data.upcoming.length > 0 && (
            <UpcomingCard
              items={data.upcoming}
              categories={data.categories}
              accounts={data.accounts}
              currency={data.currency}
              today={today}
            />
          )}
          <RecentTransactions items={data.recent} currency={data.currency} today={today} />
        </>
      ) : (
        <div className={styles.loading} aria-busy="true" aria-label="Загрузка" />
      )}
    </div>
  )
}
