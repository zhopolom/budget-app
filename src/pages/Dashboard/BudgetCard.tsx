import { Button } from '../../components/Button/Button'
import { ProgressBar } from '../../components/ProgressBar/ProgressBar'
import type { BudgetProgress } from '../../features/budgets/calculations'
import type { CurrencyCode } from '../../types/entities'
import { Money } from '../../utils/money'
import { pluralRu } from '../../utils/plural'
import styles from './BudgetCard.module.css'

interface BudgetCardProps {
  progress: BudgetProgress | null
  /** «сентября» */
  monthGenitive: string
  currency: CurrencyCode
  onSetup: () => void
}

function footerText(progress: BudgetProgress, currency: CurrencyCode): string {
  if (progress.isOver) {
    return `Превышен на ${Money.format(-progress.remaining, currency)}`
  }
  const remaining = Money.format(progress.remaining, currency)
  if (progress.daysLeft === null) return `Осталось ${remaining}`
  return `Осталось ${remaining} на ${progress.daysLeft} ${pluralRu(progress.daysLeft, ['день', 'дня', 'дней'])}`
}

export function BudgetCard({ progress, monthGenitive, currency, onSetup }: BudgetCardProps) {
  const title = `Бюджет ${monthGenitive}`

  if (!progress) {
    return (
      <section className={styles.card} aria-label={title}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.hint}>Задайте лимит расходов — будет видно, сколько ещё можно потратить.</p>
        <Button variant="secondary" onClick={onSetup} className={styles.setup}>
          Установить бюджет
        </Button>
      </section>
    )
  }

  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        <span className={styles.percent} data-tone={progress.tone}>
          {progress.percent}%
        </span>
      </div>

      <p className={styles.amounts}>
        {Money.format(progress.spent, currency, { symbol: false })}
        <span className={styles.limit}> / {Money.format(progress.limit, currency)}</span>
      </p>

      <ProgressBar value={progress.ratio} tone={progress.tone} label={`Израсходовано ${progress.percent}% бюджета`} />

      <p className={styles.footer} data-tone={progress.tone}>
        {footerText(progress, currency)}
      </p>
    </section>
  )
}
