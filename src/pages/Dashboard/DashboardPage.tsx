import { navigate } from '../../app/navigation'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { useToday } from '../../hooks/useToday'
import { formatMonthGenitive, formatMonthTitle, fromIsoDate, toYearMonth } from '../../utils/dates'
import { BalanceSummary } from './BalanceSummary'
import { BudgetCard } from './BudgetCard'
import styles from './DashboardPage.module.css'
import { RecentTransactions } from './RecentTransactions'
import { useDashboardData } from './useDashboardData'

export function DashboardPage() {
  const today = useToday()
  const data = useDashboardData(today)
  const month = data?.month ?? toYearMonth(fromIsoDate(today))

  return (
    <div className={styles.page}>
      <PageHeader title={formatMonthTitle(month)} />

      {data ? (
        <>
          <BalanceSummary
            totalBalance={data.totalBalance}
            monthTotals={data.monthTotals}
            currency={data.currency}
          />
          <BudgetCard
            progress={data.budget}
            monthGenitive={formatMonthGenitive(month)}
            currency={data.currency}
            onSetup={() => navigate('/settings')}
          />
          <RecentTransactions items={data.recent} currency={data.currency} today={today} />
        </>
      ) : (
        <div className={styles.loading} aria-busy="true" aria-label="Загрузка" />
      )}
    </div>
  )
}
