import { navigate } from '../../app/navigation'
import { useSelectedMonth } from '../../app/selectedMonth'
import { MonthSelector } from '../../components/MonthSelector/MonthSelector'
import { useToday } from '../../hooks/useToday'
import { formatMonthGenitive } from '../../utils/dates'
import { BalanceSummary } from './BalanceSummary'
import { BudgetCard } from './BudgetCard'
import { CategoryBudgets } from './CategoryBudgets'
import styles from './DashboardPage.module.css'
import { RecentTransactions } from './RecentTransactions'
import { RecoveredAccountBanner } from './RecoveredAccountBanner'
import { useDashboardData } from './useDashboardData'

export function DashboardPage() {
  const today = useToday()
  const selection = useSelectedMonth(today)
  const data = useDashboardData(selection.month, today)

  return (
    <div className={styles.page}>
      <MonthSelector selection={selection} />

      <RecoveredAccountBanner />

      {data ? (
        <>
          <BalanceSummary totalBalance={data.totalBalance} monthTotals={data.monthTotals} currency={data.currency} />
          <BudgetCard
            progress={data.budget}
            monthGenitive={formatMonthGenitive(selection.month)}
            currency={data.currency}
            onSetup={() => navigate('/budgets')}
          />
          <CategoryBudgets items={data.categoryBudgets} currency={data.currency} />
          <RecentTransactions items={data.recent} currency={data.currency} today={today} />
        </>
      ) : (
        <div className={styles.loading} aria-busy="true" aria-label="Загрузка" />
      )}
    </div>
  )
}
