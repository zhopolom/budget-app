import { useState } from 'react'
import { navigate } from '../../app/navigation'
import { Button } from '../../components/Button/Button'
import { useConfirm } from '../../components/Confirm/confirmContext'
import { useToast } from '../../components/Toast/toastContext'
import {
  formatRecurringAmount,
  recurringAccountsLabel,
  recurringIcon,
  recurringTitle,
} from '../../features/recurring/labels'
import { pendingOccurrencesRepository, type PendingOccurrenceView } from '../../features/recurring/pending'
import type { Account, Category, CurrencyCode, Id, IsoDate } from '../../types/entities'
import { formatFutureDay } from '../../utils/dates'
import styles from './PendingCard.module.css'

interface PendingCardProps {
  items: readonly PendingOccurrenceView[]
  categories: readonly Category[]
  accounts: readonly Account[]
  currency: CurrencyCode
  today: IsoDate
}

/**
 * «Ожидают подтверждения» (ТЗ §25): вхождения расписаний в режиме confirm.
 * Это ещё не операции — в остаток они попадут только после «Подтвердить».
 * «Изменить» открывает форму с полями этой операции, «Пропустить» — ничего
 * не создаёт, но день закрывает.
 */
export function PendingCard({ items, categories, accounts, currency, today }: PendingCardProps) {
  const [busyId, setBusyId] = useState<Id | null>(null)
  const toast = useToast()
  const confirmDialog = useConfirm()

  const run = async (id: Id, action: () => Promise<unknown>, message: string) => {
    setBusyId(id)
    try {
      await action()
      toast.show(message)
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Не удалось сохранить', { tone: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  const skip = async (view: PendingOccurrenceView) => {
    const title = recurringTitle(view.rule, categories, accounts)
    const confirmed = await confirmDialog({
      title: 'Пропустить операцию?',
      message: `${title}, ${formatRecurringAmount(view.rule, currency)} за ${formatFutureDay(view.occurrence.scheduledDate, today).toLowerCase()} не запишется. Расписание продолжит работать.`,
      confirmLabel: 'Пропустить',
      cancelLabel: 'Оставить',
    })
    if (!confirmed) return
    await run(view.occurrence.id, () => pendingOccurrencesRepository.skip(view.occurrence.id), 'Операция пропущена')
  }

  return (
    <section className={styles.card} aria-labelledby="pending-title">
      <div className={styles.head}>
        <h2 id="pending-title" className={styles.title}>
          Ожидают подтверждения
        </h2>
        <span className={styles.count}>{items.length}</span>
      </div>

      <ul className={styles.list}>
        {items.map((view) => {
          const { occurrence, rule } = view
          const busy = busyId === occurrence.id
          return (
            <li key={occurrence.id} className={styles.item}>
              <div className={styles.row}>
                <span className={styles.icon} aria-hidden="true">
                  {recurringIcon(rule, categories)}
                </span>
                <div className={styles.main}>
                  <span className={styles.name}>{recurringTitle(rule, categories, accounts)}</span>
                  <span className={styles.meta}>
                    {formatFutureDay(occurrence.scheduledDate, today)} · {recurringAccountsLabel(rule, accounts)}
                  </span>
                </div>
                <span className={styles.amount} data-type={rule.type}>
                  {formatRecurringAmount(rule, currency)}
                </span>
              </div>

              <div className={styles.actions}>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(occurrence.id, () => pendingOccurrencesRepository.confirm(occurrence.id), 'Операция записана')
                  }
                >
                  Подтвердить
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => navigate(`/confirm?id=${encodeURIComponent(occurrence.id)}`)}
                >
                  Изменить
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void skip(view)}>
                  Пропустить
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
