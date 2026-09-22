import { navigate } from '../../app/navigation'
import { Link } from '../../components/Link/Link'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import type { UpcomingOccurrence } from '../../features/forecast/service'
import {
  formatRecurringAmount,
  recurringAccountsLabel,
  recurringIcon,
  recurringTitle,
} from '../../features/recurring/labels'
import type { Account, Category, CurrencyCode, IsoDate } from '../../types/entities'
import { formatFutureDay } from '../../utils/dates'
import styles from './UpcomingCard.module.css'

interface UpcomingCardProps {
  items: readonly UpcomingOccurrence[]
  categories: readonly Category[]
  accounts: readonly Account[]
  currency: CurrencyCode
  today: IsoDate
}

/**
 * Ближайшие регулярные операции (ТЗ §19). Это прогноз: строки не операции,
 * в историю они попадут только когда наступит дата. Тап ведёт к расписанию.
 */
export function UpcomingCard({ items, categories, accounts, currency, today }: UpcomingCardProps) {
  return (
    <section aria-labelledby="upcoming-title">
      <div className={styles.header}>
        <h2 id="upcoming-title" className={styles.title}>
          Ближайшие операции
        </h2>
        <Link to="/recurring" className={styles.link}>
          Расписания
        </Link>
      </div>

      <ListCard label="Ближайшие операции">
        {items.map(({ rule, date }) => {
          const title = recurringTitle(rule, categories, accounts)
          const accountsLabel = recurringAccountsLabel(rule, accounts)
          const day = formatFutureDay(date, today)
          return (
            <ListItem key={`${rule.id}:${date}`}>
              <ListRow
                icon={recurringIcon(rule, categories)}
                title={title}
                // У перевода без комментария название и есть счета — не повторяем
                subtitle={title === accountsLabel ? day : `${day} · ${accountsLabel}`}
                value={
                  <span className={styles.amount} data-type={rule.type}>
                    {formatRecurringAmount(rule, currency)}
                  </span>
                }
                onClick={() => navigate(`/recurring?edit=${encodeURIComponent(rule.id)}`)}
              />
            </ListItem>
          )
        })}
      </ListCard>

      <p className={styles.note}>Запишутся в историю в день срока — сейчас это только план.</p>
    </section>
  )
}
