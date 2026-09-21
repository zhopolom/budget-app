import { useMemo, useState } from 'react'
import { navigate } from '../../app/navigation'
import { useSelectedMonth } from '../../app/selectedMonth'
import { Button } from '../../components/Button/Button'
import { EmptyState } from '../../components/EmptyState/EmptyState'
import { MonthSelector } from '../../components/MonthSelector/MonthSelector'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { SearchField } from '../../components/SearchField/SearchField'
import { TransactionItem } from '../../components/TransactionItem/TransactionItem'
import {
  applyFilters,
  countActiveFilters,
  EMPTY_FILTERS,
  PERIOD_LABELS,
  type TransactionFilters,
} from '../../features/transactions/filters'
import { groupByDay } from '../../features/transactions/grouping'
import { useToday } from '../../hooks/useToday'
import type { Id } from '../../types/entities'
import { formatDayLabel } from '../../utils/dates'
import { Money } from '../../utils/money'
import { FiltersSheet } from './FiltersSheet'
import styles from './TransactionsPage.module.css'
import { useTransactionsData } from './useTransactionsData'

// Вне компонента — стабильная ссылка, memo у TransactionItem не сбрасывается
const openTransaction = (id: Id) => navigate(`/edit?id=${encodeURIComponent(id)}`)

export function TransactionsPage() {
  const today = useToday()
  const selection = useSelectedMonth(today)
  const [filters, setFilters] = useState<TransactionFilters>(EMPTY_FILTERS)
  const [query, setQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const data = useTransactionsData(selection.month, filters)

  const groups = useMemo(
    () => (data ? groupByDay(applyFilters(data.views, filters, query)) : []),
    [data, filters, query],
  )

  const activeCount = countActiveFilters(filters)
  const total = groups.reduce((sum, group) => sum + group.items.length, 0)
  const isSearching = query.trim() !== ''
  const isFiltered = activeCount > 0 || isSearching

  return (
    <div className={styles.page}>
      <PageHeader title="Операции" />
      {/* Период задаётся фильтрами, но месяц остаётся общим для всех экранов */}
      {filters.period === 'month' ? (
        <MonthSelector selection={selection} />
      ) : (
        <p className={styles.period}>Период: {PERIOD_LABELS[filters.period].toLowerCase()}</p>
      )}

      <div className={styles.controls}>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Поиск по операциям"
          placeholder="Комментарий, категория, счёт"
        />
        <div className={styles.filterRow}>
          <Button variant="secondary" onClick={() => setFiltersOpen(true)}>
            {activeCount > 0 ? `Фильтры (${activeCount})` : 'Фильтры'}
          </Button>
          {isFiltered && (
            <button
              type="button"
              className={styles.reset}
              onClick={() => {
                setFilters(EMPTY_FILTERS)
                setQuery('')
              }}
            >
              Сбросить
            </button>
          )}
          {data && total > 0 && <span className={styles.count}>{total}</span>}
        </div>
      </div>

      {!data && <div className={styles.loading} aria-busy="true" aria-label="Загрузка" />}

      {data && groups.length === 0 && (
        <div className={styles.card}>
          {isSearching ? (
            <EmptyState icon="🔍" title="Ничего не нашлось" text={`По запросу «${query.trim()}» операций нет.`} />
          ) : isFiltered ? (
            <EmptyState
              icon="🧮"
              title="Под фильтры ничего не подошло"
              text="Попробуйте смягчить условия."
              action={<Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>Сбросить фильтры</Button>}
            />
          ) : (
            <EmptyState
              icon="🧾"
              title="Операций за этот месяц нет"
              text="Нажмите «+» внизу, чтобы добавить расход, доход или перевод."
            />
          )}
        </div>
      )}

      {data &&
        groups.map((group) => (
          <section key={group.date} className={styles.day} aria-label={formatDayLabel(group.date, today)}>
            <div className={styles.dayHead}>
              <h2 className={styles.dayTitle}>{formatDayLabel(group.date, today)}</h2>
              <span className={styles.dayTotal}>
                {group.expense > 0 && Money.format(-group.expense, data.currency, { sign: 'always' })}
                {group.expense > 0 && group.income > 0 && ' · '}
                {group.income > 0 && (
                  <span className={styles.income}>
                    {Money.format(group.income, data.currency, { sign: 'always' })}
                  </span>
                )}
              </span>
            </div>

            <ul className={styles.list}>
              {group.items.map((view) => (
                <li key={view.transaction.id}>
                  {/* Дата уже стоит в заголовке дня — в строке она лишняя */}
                  <TransactionItem view={view} currency={data.currency} onSelect={openTransaction} />
                </li>
              ))}
            </ul>
          </section>
        ))}

      {data && (
        <FiltersSheet
          open={filtersOpen}
          value={filters}
          accounts={data.accounts}
          categories={data.categories}
          currency={data.currency}
          onApply={setFilters}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </div>
  )
}
