import { useState } from 'react'
import { Button } from '../../components/Button/Button'
import { useConfirm } from '../../components/Confirm/confirmContext'
import { EmptyState } from '../../components/EmptyState/EmptyState'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { ProgressBar } from '../../components/ProgressBar/ProgressBar'
import { Sheet } from '../../components/Sheet/Sheet'
import { useToast } from '../../components/Toast/toastContext'
import { goalsRepository } from '../../features/goals/repository'
import type { GoalProgress } from '../../features/goals/service'
import { useToday } from '../../hooks/useToday'
import type { CurrencyCode, Id } from '../../types/entities'
import { formatMonthGenitive, yearMonthOf } from '../../utils/dates'
import { Money } from '../../utils/money'
import { GoalForm } from './GoalForm'
import styles from './GoalsPage.module.css'
import { useGoalsData } from './useGoalsData'

type SheetState = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; id: Id }

/** «до декабря 2026» */
function deadlineLabel(targetDate: string): string {
  const ym = yearMonthOf(targetDate)
  return `до ${formatMonthGenitive(ym)} ${ym.year}`
}

function footerText(item: GoalProgress, currency: CurrencyCode): string {
  const remaining = Money.format(item.remaining, currency)
  if (item.status === 'reached') return 'Цель достигнута'
  if (item.status === 'overdue') return `Срок прошёл · осталось ${remaining}`
  if (item.requiredMonthly !== null) return `Осталось ${remaining} · ≈${Money.format(item.requiredMonthly, currency)} в месяц`
  return `Осталось ${remaining}`
}

function metaText(item: GoalProgress): string {
  const parts = [item.account ? `Счёт: ${item.account.name}` : 'Без счёта']
  if (item.goal.targetDate) parts.push(deadlineLabel(item.goal.targetDate))
  return parts.join(' · ')
}

export function GoalsPage() {
  const today = useToday()
  const data = useGoalsData(today)
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' })
  const toast = useToast()
  const confirm = useConfirm()

  const close = () => setSheet({ kind: 'closed' })
  const all = data ? [...data.active, ...data.archived] : []
  const current = sheet.kind === 'edit' ? all.find((item) => item.goal.id === sheet.id) : undefined
  const isOpen = sheet.kind === 'create' || current !== undefined

  const remove = async (item: GoalProgress) => {
    const confirmed = await confirm({
      title: 'Удалить цель?',
      message: `«${item.goal.name}» исчезнет из списка. ${item.account ? `Счёт «${item.account.name}» и операции по нему останутся.` : 'Операции не затрагиваются.'}`,
      confirmLabel: 'Удалить',
      tone: 'danger',
    })
    if (!confirmed) return
    await goalsRepository.remove(item.goal.id)
    close()
    toast.show('Цель удалена')
  }

  const toggleArchive = async (item: GoalProgress) => {
    await goalsRepository.setArchived(item.goal.id, !item.goal.isArchived)
    close()
    toast.show(item.goal.isArchived ? 'Цель возвращена из архива' : 'Цель в архиве')
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Цели" backTo="/settings" />

      {data && data.freeAfterRecurring !== null && (
        <p className={styles.note}>
          После регулярных платежей до конца месяца остаётся{' '}
          <strong>{Money.format(data.freeAfterRecurring, data.currency)}</strong>. Пополнить цель можно переводом на
          её накопительный счёт — это не расход.
        </p>
      )}

      {data && all.length === 0 && (
        <div className={styles.card}>
          <EmptyState
            icon="🎯"
            title="Целей пока нет"
            text="Ноутбук, отпуск, подушка безопасности: цель покажет, сколько осталось и сколько откладывать в месяц."
            action={<Button onClick={() => setSheet({ kind: 'create' })}>Добавить цель</Button>}
          />
        </div>
      )}

      {data && data.active.length > 0 && (
        <ul className={styles.list} aria-label="Цели">
          {data.active.map((item) => (
            <li key={item.goal.id}>
              <GoalCard item={item} currency={data.currency} onOpen={() => setSheet({ kind: 'edit', id: item.goal.id })} />
            </li>
          ))}
        </ul>
      )}

      {data && all.length > 0 && (
        <Button variant="secondary" block onClick={() => setSheet({ kind: 'create' })}>
          Добавить цель
        </Button>
      )}

      {data && data.archived.length > 0 && (
        <section className={styles.section} aria-label="Архив целей">
          <h2 className={styles.sectionTitle}>Архив</h2>
          <ul className={styles.list}>
            {data.archived.map((item) => (
              <li key={item.goal.id}>
                <GoalCard item={item} currency={data.currency} archived onOpen={() => setSheet({ kind: 'edit', id: item.goal.id })} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <Sheet open={isOpen} onClose={close} title={sheet.kind === 'create' ? 'Новая цель' : 'Цель'}>
        {data && (
          // key: при смене цели форма стартует заново с её данными
          <div key={sheet.kind === 'edit' ? sheet.id : 'create'}>
            {sheet.kind === 'create' && (
              <GoalForm goal={null} accounts={data.accounts} currency={data.currency} onDone={close} />
            )}
            {current && (
              <GoalForm
                goal={current.goal}
                accounts={data.accounts}
                currency={data.currency}
                onDone={close}
                onArchiveToggle={() => void toggleArchive(current)}
                onDelete={() => void remove(current)}
              />
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}

function GoalCard({
  item,
  currency,
  archived = false,
  onOpen,
}: {
  item: GoalProgress
  currency: CurrencyCode
  archived?: boolean
  onOpen: () => void
}) {
  return (
    <button type="button" className={styles.goal} data-archived={archived || undefined} onClick={onOpen}>
      <span className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          {item.goal.icon}
        </span>
        <span className={styles.name}>{item.goal.name}</span>
        <span className={styles.percent} data-status={item.status}>
          {item.percent}%
        </span>
      </span>

      <span className={styles.amounts}>
        {Money.format(item.current, currency, { symbol: false })}
        <span className={styles.target}> / {Money.format(item.target, currency)}</span>
      </span>

      <ProgressBar
        value={item.ratio}
        tone={item.status === 'overdue' ? 'warning' : 'normal'}
        label={`${item.goal.name}: накоплено ${item.percent}%`}
      />

      <span className={styles.footer} data-status={item.status}>
        {footerText(item, currency)}
      </span>
      <span className={styles.meta}>{metaText(item)}</span>
    </button>
  )
}
