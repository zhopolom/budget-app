import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { FullScreenLayout } from '../../app/FullScreenLayout'
import { goBack, useSearchParam } from '../../app/navigation'
import { Button } from '../../components/Button/Button'
import { EmptyState } from '../../components/EmptyState/EmptyState'
import { useToast } from '../../components/Toast/toastContext'
import { TransactionForm } from '../../components/TransactionForm/TransactionForm'
import { db } from '../../db/database'
import { pendingOccurrencesRepository } from '../../features/recurring/pending'
import { useTransactionEditorData } from '../../features/transactions/useTransactionEditorData'
import { draftFromRecurringOccurrence } from '../../features/transactions/validation'
import type { PendingOccurrence, RecurringTransaction } from '../../types/entities'
import styles from './ConfirmOccurrencePage.module.css'

interface Loaded {
  occurrence: PendingOccurrence | null
  rule: RecurringTransaction | null
}

const RESOLVED_TITLES: Record<Exclude<PendingOccurrence['status'], 'pending'>, string> = {
  confirmed: 'Операция уже записана',
  skipped: 'Операция уже пропущена',
}

/**
 * «Изменить» у ожидающего вхождения (ТЗ §25): форма операции с полями по
 * расписанию. Подтверждение создаёт операцию с изменениями; само расписание
 * меняется только по явному переключателю «Изменить и все будущие».
 */
export function ConfirmOccurrencePage() {
  const id = useSearchParam('id')
  const data = useTransactionEditorData()
  const [applyToRule, setApplyToRule] = useState(false)
  const [closing, setClosing] = useState(false)
  const toast = useToast()

  const loaded = useLiveQuery(async (): Promise<Loaded> => {
    if (!id) return { occurrence: null, rule: null }
    const occurrence = (await pendingOccurrencesRepository.get(id)) ?? null
    const rule = occurrence ? ((await db.recurringTransactions.get(occurrence.recurringId)) ?? null) : null
    return { occurrence, rule }
  }, [id])

  const close = () => {
    // Не даём экрану мигнуть пустым состоянием, пока идёт переход назад
    setClosing(true)
    goBack('/')
  }

  if (closing) return null

  const occurrence = loaded?.occurrence ?? null
  const rule = loaded?.rule ?? null
  const ready = loaded !== undefined && data !== undefined

  return (
    <FullScreenLayout title="Подтверждение" onClose={close}>
      {ready && !occurrence && (
        <EmptyState icon="🔍" title="Операция не найдена" text="Возможно, её уже подтвердили или пропустили." action={<Button onClick={close}>На главную</Button>} />
      )}

      {ready && occurrence && occurrence.status !== 'pending' && (
        <EmptyState icon="✅" title={RESOLVED_TITLES[occurrence.status]} action={<Button onClick={close}>На главную</Button>} />
      )}

      {ready && occurrence && occurrence.status === 'pending' && !rule && (
        <EmptyState icon="🔁" title="Расписание удалено" text="Подтверждать нечего: правило, создавшее эту операцию, уже удалено." action={<Button onClick={close}>На главную</Button>} />
      )}

      {ready && occurrence && occurrence.status === 'pending' && rule && (
        <TransactionForm
          key={occurrence.id}
          initial={draftFromRecurringOccurrence(rule, occurrence.scheduledDate)}
          data={data}
          mode="edit"
          lockType
          submitLabel="Подтвердить"
          extra={
            <label className={styles.toggle}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={applyToRule}
                onChange={(event) => setApplyToRule(event.target.checked)}
              />
              <span className={styles.toggleText}>
                <span className={styles.toggleTitle}>Изменить и все будущие</span>
                <span className={styles.toggleHint}>
                  Расписание получит те же значения. Дата останется только у этой операции.
                </span>
              </span>
            </label>
          }
          onSubmit={async (input) => {
            await pendingOccurrencesRepository.confirm(occurrence.id, { override: input, applyToRule })
            toast.show(applyToRule ? 'Операция записана, расписание обновлено' : 'Операция записана')
            close()
          }}
        />
      )}
    </FullScreenLayout>
  )
}
