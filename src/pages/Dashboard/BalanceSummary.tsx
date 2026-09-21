import type { Totals } from '../../features/transactions/calculations'
import type { CurrencyCode, MinorUnits } from '../../types/entities'
import { Money } from '../../utils/money'
import styles from './BalanceSummary.module.css'

interface BalanceSummaryProps {
  totalBalance: MinorUnits
  monthTotals: Totals
  currency: CurrencyCode
}

export function BalanceSummary({ totalBalance, monthTotals, currency }: BalanceSummaryProps) {
  return (
    <section className={styles.summary} aria-label="Баланс">
      <div className={styles.balance}>
        <p className={styles.label}>Общий баланс</p>
        <p className={styles.value} data-negative={totalBalance < 0 || undefined}>
          {Money.format(totalBalance, currency)}
        </p>
      </div>

      <dl className={styles.tiles}>
        <div className={styles.tile}>
          <dt className={styles.tileLabel}>Доходы</dt>
          <dd className={`${styles.tileValue} ${styles.income}`}>
            {Money.format(monthTotals.income, currency, { sign: 'always' })}
          </dd>
        </div>
        <div className={styles.tile}>
          <dt className={styles.tileLabel}>Расходы</dt>
          <dd className={styles.tileValue}>{Money.format(-monthTotals.expense, currency, { sign: 'always' })}</dd>
        </div>
      </dl>
    </section>
  )
}
