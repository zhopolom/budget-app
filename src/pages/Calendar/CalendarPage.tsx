import { useMemo, useState } from 'react'
import { navigate } from '../../app/navigation'
import { useSelectedMonth } from '../../app/selectedMonth'
import { EmptyState } from '../../components/EmptyState/EmptyState'
import { MonthSelector } from '../../components/MonthSelector/MonthSelector'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { SegmentedControl } from '../../components/SegmentedControl/SegmentedControl'
import { TransactionItem } from '../../components/TransactionItem/TransactionItem'
import { groupByDay } from '../../features/transactions/grouping'
import { useToday } from '../../hooks/useToday'
import type { Id, IsoDate } from '../../types/entities'
import { formatDayLabel, isSameYearMonth, yearMonthOf } from '../../utils/dates'
import { Money } from '../../utils/money'
import { pluralRu } from '../../utils/plural'
import styles from './CalendarPage.module.css'
import { MonthGrid } from './MonthGrid'
import { useCalendarData } from './useCalendarData'

const VIEW_OPTIONS = [
  { value: 'list', label: 'Список' },
  { value: 'calendar', label: 'Календарь' },
] as const

const openTransaction = (id: Id) => navigate(`/edit?id=${encodeURIComponent(id)}`)

export function CalendarPage() {
  const today = useToday()
  const selection = useSelectedMonth(today)
  const data = useCalendarData(selection.month)
  const [selected, setSelected] = useState<IsoDate | null>(null)

  // Выбранный день сбрасывается при смене месяца: 31-го числа в феврале нет
  const day = selected && isSameYearMonth(yearMonthOf(selected), selection.month) ? selected : null

  const dayItems = useMemo(() => {
    if (!data || !day) return []
    const [group] = groupByDay(data.views.filter((view) => view.transaction.date === day))
    return group?.items ?? []
  }, [data, day])

  return (
    <div className={styles.page}>
      <PageHeader title="Операции" />

      <SegmentedControl
        options={VIEW_OPTIONS}
        value="calendar"
        onChange={(value) => value === 'list' && navigate('/transactions')}
        label="Вид"
      />

      <MonthSelector selection={selection} />

      {!data && <div className={styles.loading} aria-busy="true" aria-label="Загрузка" />}

      {data && (
        <>
          <MonthGrid
            month={selection.month}
            expenses={data.expenses}
            active={data.active}
            selected={day}
            today={today}
            currency={data.currency}
            onSelect={(date) => setSelected(date === day ? null : date)}
          />

          <p className={styles.summary}>
            За месяц {Money.format(data.totals.expense, data.currency)}
            {data.expenses.size > 0 &&
              ` · ${data.expenses.size} ${pluralRu(data.expenses.size, ['день', 'дня', 'дней'])} с тратами`}
          </p>

          {day && (
            <section className={styles.day} aria-label={`Операции за ${formatDayLabel(day, today)}`}>
              <h2 className={styles.dayTitle}>{formatDayLabel(day, today)}</h2>

              {dayItems.length === 0 ? (
                <div className={styles.card}>
                  <EmptyState icon="🗓️" title="В этот день операций не было" />
                </div>
              ) : (
                <ul className={styles.list}>
                  {dayItems.map((view) => (
                    <li key={view.transaction.id}>
                      <TransactionItem view={view} currency={data.currency} onSelect={openTransaction} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {!day && <p className={styles.hint}>Нажмите на день, чтобы увидеть его операции.</p>}
        </>
      )}
    </div>
  )
}
