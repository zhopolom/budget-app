import { EmptyState } from '../../components/EmptyState/EmptyState'
import { Link } from '../../components/Link/Link'
import { TransactionRow } from '../../components/TransactionItem/TransactionRow'
import type { TransactionView } from '../../features/transactions/views'
import type { CurrencyCode, IsoDate } from '../../types/entities'
import { formatDayShort } from '../../utils/dates'
import styles from './RecentTransactions.module.css'

interface RecentTransactionsProps {
  items: TransactionView[]
  currency: CurrencyCode
  today: IsoDate
}

export function RecentTransactions({ items, currency, today }: RecentTransactionsProps) {
  return (
    <section aria-labelledby="recent-title">
      <div className={styles.header}>
        <h2 id="recent-title" className={styles.title}>
          Последние операции
        </h2>
        {items.length > 0 && (
          <Link to="/transactions" className={styles.link}>
            Все
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <div className={styles.card}>
          <EmptyState
            icon="🧾"
            title="Операций пока нет"
            text="Нажмите «+» внизу, чтобы добавить первый расход или доход."
          />
        </div>
      ) : (
        <ul className={`${styles.card} ${styles.list}`}>
          {items.map((view) => (
            <li key={view.transaction.id} className={styles.row}>
              <TransactionRow
                view={view}
                currency={currency}
                dayLabel={formatDayShort(view.transaction.date, today)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
