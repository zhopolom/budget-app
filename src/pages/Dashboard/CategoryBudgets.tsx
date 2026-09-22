import { navigate } from '../../app/navigation'
import { Button } from '../../components/Button/Button'
import { EmptyState } from '../../components/EmptyState/EmptyState'
import { Link } from '../../components/Link/Link'
import { ProgressBar } from '../../components/ProgressBar/ProgressBar'
import type { CategoryBudgetProgress } from '../../features/budgets/calculations'
import type { CurrencyCode } from '../../types/entities'
import { Money } from '../../utils/money'
import styles from './CategoryBudgets.module.css'

interface CategoryBudgetsProps {
  items: CategoryBudgetProgress[]
  currency: CurrencyCode
}

/** «3 420 / 5 000 ₴» — потрачено из лимита. */
function amountsText(item: CategoryBudgetProgress, currency: CurrencyCode): string {
  return `${Money.format(item.spent, currency, { symbol: false })} / ${Money.format(item.limit, currency)}`
}

export function CategoryBudgets({ items, currency }: CategoryBudgetsProps) {
  return (
    <section className={styles.section} aria-labelledby="category-budgets-title">
      <div className={styles.header}>
        <h2 id="category-budgets-title" className={styles.title}>
          Категории
        </h2>
        {items.length > 0 && (
          <Link to="/budgets" className={styles.link}>
            Настроить
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <div className={styles.card}>
          <EmptyState
            icon="🎯"
            title="Лимитов пока нет"
            text="Задайте лимит на продукты или транспорт — будет видно, сколько ещё можно потратить."
            action={
              <Button variant="secondary" onClick={() => navigate('/budgets')}>
                Задать лимит
              </Button>
            }
          />
        </div>
      ) : (
        <ul className={styles.card}>
          {items.map((item) => (
            <li key={item.category.id} className={styles.row}>
              <div className={styles.head}>
                <span className={styles.icon} aria-hidden="true">
                  {item.category.icon}
                </span>
                <span className={styles.name}>{item.category.name}</span>
                <span className={styles.percent} data-tone={item.tone}>
                  {item.percent}%
                </span>
              </div>

              <p className={styles.amounts}>{amountsText(item, currency)}</p>
              {item.carry > 0 && (
                <p className={styles.carry}>
                  {Money.format(item.baseLimit, currency)} + {Money.format(item.carry, currency)} перенос с прошлого месяца
                </p>
              )}

              <ProgressBar
                value={item.ratio}
                tone={item.tone}
                label={`${item.category.name}: израсходовано ${item.percent}% лимита`}
              />

              {/* Спокойная формулировка: сообщаем факт, не отчитываем */}
              <p className={styles.footer} data-tone={item.tone}>
                {item.isOver
                  ? `+${Money.format(-item.remaining, currency)} сверх лимита`
                  : `Осталось ${Money.format(item.remaining, currency)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
