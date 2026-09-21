import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Button } from '../../components/Button/Button'
import { useConfirm } from '../../components/Confirm/confirmContext'
import { EmptyState } from '../../components/EmptyState/EmptyState'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { Sheet } from '../../components/Sheet/Sheet'
import { useToast } from '../../components/Toast/toastContext'
import { MISSING_CATEGORY } from '../../features/categories/defaults'
import { describeRecurrence } from '../../features/recurring/occurrences'
import { recurringRepository } from '../../features/recurring/repository'
import {
  draftFromRecurring,
  emptyRecurringDraft,
} from '../../features/recurring/validation'
import { pickDefaultAccountId, useTransactionEditorData } from '../../features/transactions/useTransactionEditorData'
import { useToday } from '../../hooks/useToday'
import type { Id, RecurringTransaction } from '../../types/entities'
import { formatFutureDay } from '../../utils/dates'
import { Money } from '../../utils/money'
import { pluralRu } from '../../utils/plural'
import { RecurringForm } from './RecurringForm'
import styles from './RecurringPage.module.css'

type SheetState = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; id: Id }

export function RecurringPage() {
  const today = useToday()
  const data = useTransactionEditorData()
  const items = useLiveQuery(() => recurringRepository.listAll(), [])
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' })
  const toast = useToast()
  const confirm = useConfirm()

  const close = () => setSheet({ kind: 'closed' })
  const current = sheet.kind === 'edit' ? items?.find((item) => item.id === sheet.id) : undefined
  const isOpen = sheet.kind === 'create' || current !== undefined

  const remove = async (recurring: RecurringTransaction) => {
    const created = await recurringRepository.countGenerated(recurring.id)
    const confirmed = await confirm({
      title: 'Удалить регулярную операцию?',
      message:
        created > 0
          ? `${created} ${pluralRu(created, ['операция останется', 'операции останутся', 'операций останутся'])} в истории — удаляется только расписание.`
          : 'Новые операции по этому расписанию создаваться не будут.',
      confirmLabel: 'Удалить',
      tone: 'danger',
    })
    if (!confirmed) return

    await recurringRepository.remove(recurring.id)
    close()
    toast.show('Регулярная операция удалена')
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Регулярные операции" backTo="/settings" />

      <p className={styles.note}>
        Операции создаются при открытии приложения. Не заходили месяц — пропущенные добавятся все сразу, по одному разу.
      </p>

      {items && items.length === 0 && (
        <div className={styles.card}>
          <EmptyState
            icon="🔁"
            title="Пока пусто"
            text="Добавьте аренду, подписку или зарплату — они будут записываться сами."
            action={<Button onClick={() => setSheet({ kind: 'create' })}>Добавить</Button>}
          />
        </div>
      )}

      {items && items.length > 0 && data && (
        <>
          <ListCard label="Регулярные операции">
            {items.map((item) => {
              const category = data.categories.find((entry) => entry.id === item.categoryId)
              return (
                <ListItem key={item.id}>
                  <ListRow
                    icon={category?.icon ?? MISSING_CATEGORY.icon}
                    title={item.note.trim() || category?.name || MISSING_CATEGORY.name}
                    subtitle={subtitleFor(item, today)}
                    value={
                      <span className={styles.amount} data-type={item.type} data-off={!item.isActive || undefined}>
                        {Money.format(
                          item.type === 'expense' ? -item.amount : item.amount,
                          data.settings.baseCurrency,
                          { sign: 'always' },
                        )}
                      </span>
                    }
                    onClick={() => setSheet({ kind: 'edit', id: item.id })}
                  />
                </ListItem>
              )
            })}
          </ListCard>

          <Button variant="secondary" block onClick={() => setSheet({ kind: 'create' })}>
            Добавить регулярную операцию
          </Button>
        </>
      )}

      <Sheet
        open={isOpen}
        onClose={close}
        title={sheet.kind === 'create' ? 'Новая регулярная операция' : 'Регулярная операция'}
      >
        {data && (
          // key: при смене записи форма стартует заново с её данными
          <div key={sheet.kind === 'edit' ? sheet.id : 'create'}>
            {sheet.kind === 'create' && (
              <RecurringForm
                initial={emptyRecurringDraft(pickDefaultAccountId(data.accounts, data.settings.lastAccountId), today)}
                data={data}
                mode="create"
                onSubmit={async (input) => {
                  await recurringRepository.create(input, today)
                  close()
                  toast.show('Регулярная операция создана')
                }}
              />
            )}

            {current && (
              <RecurringForm
                initial={draftFromRecurring(current)}
                data={data}
                mode="edit"
                onSubmit={async (input) => {
                  await recurringRepository.update(current.id, input, today)
                  close()
                  toast.show('Регулярная операция изменена')
                }}
                onDelete={() => void remove(current)}
              />
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}

function subtitleFor(item: RecurringTransaction, today: string): string {
  const schedule = describeRecurrence(item.frequency, item.interval)
  if (!item.isActive) return `${schedule} · отключена`
  return `${schedule} · следующая ${formatFutureDay(item.nextOccurrence, today).toLowerCase()}`
}
