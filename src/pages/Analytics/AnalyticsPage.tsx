import { lazy, Suspense } from 'react'
import { navigate } from '../../app/navigation'
import { useSelectedMonth } from '../../app/selectedMonth'
import { EmptyState } from '../../components/EmptyState/EmptyState'
import { MonthSelector } from '../../components/MonthSelector/MonthSelector'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { TransactionItem } from '../../components/TransactionItem/TransactionItem'
import type { CategoryShare, MonthComparison } from '../../features/analytics/service'
import { MISSING_CATEGORY } from '../../features/categories/defaults'
import { useToday } from '../../hooks/useToday'
import type { CurrencyCode, Id } from '../../types/entities'
import { formatDayShort, formatMonthTitle, previousMonth } from '../../utils/dates'
import { Money } from '../../utils/money'
import { pluralRu } from '../../utils/plural'
import styles from './AnalyticsPage.module.css'
import { useAnalyticsData } from './useAnalyticsData'

// Recharts весит больше, чем всё остальное приложение: грузим только на этом экране
const DailyExpenseChart = lazy(() => import('./DailyExpenseChart'))

const openTransaction = (id: Id) => navigate(`/edit?id=${encodeURIComponent(id)}`)

export function AnalyticsPage() {
  const today = useToday()
  const selection = useSelectedMonth(today)
  const data = useAnalyticsData(selection.month, today)

  const isEmpty = data && data.transactionCount === 0

  return (
    <div className={styles.page}>
      <PageHeader title="Статистика" />
      <MonthSelector selection={selection} />

      {!data && <div className={styles.loading} aria-busy="true" aria-label="Загрузка" />}

      {isEmpty && (
        <div className={styles.card}>
          <EmptyState
            icon="📊"
            title="За этот месяц данных нет"
            text="Добавьте операции — здесь появятся расходы по дням, категории и сравнение с прошлым месяцем."
          />
        </div>
      )}

      {data && !isEmpty && (
        <>
          <section className={styles.tiles} aria-label="Итоги месяца">
            <Tile label="Расходы" value={Money.format(data.totals.expense, data.currency)} />
            <Tile label="Доходы" value={Money.format(data.totals.income, data.currency)} tone="positive" />
            <Tile label="В среднем в день" value={Money.format(data.averageDailyExpense, data.currency)} />
            <Tile
              label="Дней с тратами"
              value={`${data.daysWithExpenses} ${pluralRu(data.daysWithExpenses, ['день', 'дня', 'дней'])}`}
            />
          </section>

          <Comparison comparison={data.comparison} month={selection.month} currency={data.currency} />

          <section className={styles.block} aria-labelledby="daily-title">
            <h2 id="daily-title" className={styles.blockTitle}>
              Расходы по дням
            </h2>
            <div className={styles.card}>
              <Suspense fallback={<div className={styles.chartFallback} aria-busy="true" aria-label="Загрузка графика" />}>
                <DailyExpenseChart points={data.dailyExpenses} currency={data.currency} today={today} />
              </Suspense>
            </div>
          </section>

          <section className={styles.block} aria-labelledby="top-title">
            <h2 id="top-title" className={styles.blockTitle}>
              Основные категории
            </h2>
            {data.topCategories.length === 0 ? (
              <div className={styles.card}>
                <EmptyState icon="🧾" title="Расходов в этом месяце не было" />
              </div>
            ) : (
              <ul className={styles.categories}>
                {data.topCategories.map((share) => (
                  <CategoryRow key={share.categoryId} share={share} currency={data.currency} />
                ))}
              </ul>
            )}
          </section>

          {data.largestExpense && (
            <section className={styles.block} aria-labelledby="largest-title">
              <h2 id="largest-title" className={styles.blockTitle}>
                Самая крупная трата
              </h2>
              <div className={styles.row}>
                <TransactionItem
                  view={data.largestExpense}
                  currency={data.currency}
                  dayLabel={formatDayShort(data.largestExpense.transaction.date, today)}
                  onSelect={openTransaction}
                />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'positive' }) {
  return (
    <div className={styles.tile}>
      <p className={styles.tileLabel}>{label}</p>
      <p className={styles.tileValue} data-tone={tone}>
        {value}
      </p>
    </div>
  )
}

function Comparison({
  comparison,
  month,
  currency,
}: {
  comparison: MonthComparison
  month: Parameters<typeof previousMonth>[0]
  currency: CurrencyCode
}) {
  const { current, previous, delta, deltaPercent } = comparison
  // Без оценок вроде «вы тратите слишком много»: показываем факт и направление
  const direction = delta === 0 ? 'same' : delta > 0 ? 'up' : 'down'

  return (
    <section className={styles.compare} aria-label="Сравнение с прошлым месяцем">
      <div className={styles.compareRow}>
        <span className={styles.compareLabel}>Этот месяц</span>
        <span className={styles.compareValue}>{Money.format(current, currency)}</span>
      </div>
      <div className={styles.compareRow}>
        <span className={styles.compareLabel}>{formatMonthTitle(previousMonth(month))}</span>
        <span className={styles.compareValue} data-muted>
          {Money.format(previous, currency)}
        </span>
      </div>
      <div className={styles.compareRow}>
        <span className={styles.compareLabel}>Изменение</span>
        <span className={styles.compareDelta} data-direction={direction}>
          {deltaPercent === null
            ? Money.format(delta, currency, { sign: 'always' })
            : `${deltaPercent > 0 ? '+' : ''}${deltaPercent.toFixed(1).replace('.', ',')}%`}
        </span>
      </div>
    </section>
  )
}

function CategoryRow({ share, currency }: { share: CategoryShare; currency: CurrencyCode }) {
  return (
    <li className={styles.category}>
      <span className={styles.categoryIcon} aria-hidden="true">
        {share.category?.icon ?? MISSING_CATEGORY.icon}
      </span>
      <div className={styles.categoryMain}>
        <div className={styles.categoryHead}>
          <span className={styles.categoryName}>{share.category?.name ?? MISSING_CATEGORY.name}</span>
          <span className={styles.categoryAmount}>{Money.format(share.amount, currency)}</span>
        </div>
        <div className={styles.bar}>
          <div className={styles.barFill} style={{ width: `${Math.max(share.percent, 2)}%` }} />
        </div>
      </div>
      <span className={styles.categoryPercent}>{share.percent}%</span>
    </li>
  )
}
