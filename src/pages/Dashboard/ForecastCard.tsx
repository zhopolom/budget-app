import type { Forecast } from '../../features/forecast/service'
import type { CurrencyCode } from '../../types/entities'
import { Money } from '../../utils/money'
import styles from './ForecastCard.module.css'

interface ForecastCardProps {
  forecast: Forecast
  /** «сентября» */
  monthGenitive: string
  currency: CurrencyCode
}

/**
 * Прогноз остатка до конца месяца (ТЗ §21). Только цифры из forecastService:
 * карточка ничего не считает сама.
 */
export function ForecastCard({ forecast, monthGenitive, currency }: ForecastCardProps) {
  const title = `Прогноз до конца ${monthGenitive}`

  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.title}>{title}</h2>

      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>Сейчас</dt>
          <dd>{Money.format(forecast.currentBalance, currency)}</dd>
        </div>
        <div className={styles.row}>
          <dt>Ожидаемые доходы</dt>
          <dd data-tone={forecast.expectedIncome > 0 ? 'positive' : 'muted'}>
            {Money.format(forecast.expectedIncome, currency, { sign: 'always' })}
          </dd>
        </div>
        <div className={styles.row}>
          <dt>Запланированные расходы</dt>
          <dd data-tone={forecast.expectedExpense > 0 ? undefined : 'muted'}>
            {Money.format(-forecast.expectedExpense, currency, { sign: 'always' })}
          </dd>
        </div>
        <div className={styles.row} data-total>
          <dt>Прогноз</dt>
          <dd data-negative={forecast.projectedBalance < 0 || undefined}>{Money.format(forecast.projectedBalance, currency)}</dd>
        </div>
      </dl>

      <p className={styles.note}>
        Считается по регулярным операциям. Разовые траты и доходы сюда не входят, поэтому это ориентир, а не
        гарантированный остаток.
      </p>
    </section>
  )
}
