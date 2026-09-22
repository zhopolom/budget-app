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
import { isRecurringTransfer } from '../../features/recurring/model'
import { describeRecurrence } from '../../features/recurring/occurrences'
import { recurringRepository } from '../../features/recurring/repository'
import { draftFromRecurring, emptyRecurringDraft } from '../../features/recurring/validation'
import { TRANSFER_ICON } from '../../features/transactions/labels'
import { pickDefaultAccountId, useTransactionEditorData } from '../../features/transactions/useTransactionEditorData'
import { useToday } from '../../hooks/useToday'
import type { Account, Category, Id, IsoDate, RecurringTransaction } from '../../types/entities'
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

  /**
   * Включение спрашивает про пропущенное. По умолчанию пауза означает, что
   * платежей за это время не было, поэтому «Не создавать» — основной ответ.
   *
   * Сегодняшний платёж в число пропущенных не входит и создаётся в любом
   * случае: пауза кончилась, и он не пропущен, а наступил.
   */
  const toggleActive = async (recurring: RecurringTransaction) => {
    if (recurring.isActive) {
      await recurringRepository.setActive(recurring.id, false, today)
      toast.show('Регулярная операция отключена')
      return
    }

    const info = await recurringRepository.resumeInfo(recurring.id, today)
    const payments = (count: number) => `${count} ${pluralRu(count, ['платёж', 'платежа', 'платежей'])}`

    // Возобновлять нечего и досоздавать нечего — остаётся поправить расписание
    if (info.finished && info.missed === 0) {
      toast.show('Расписание уже закончилось — измените дату окончания', { tone: 'error' })
      return
    }

    let backfill = false

    if (info.finished) {
      backfill = await confirm({
        title: 'Расписание уже закончилось',
        message: `Создать ${payments(info.missed)}, которые не успели записаться?`,
        confirmLabel: `Создать ${info.missed}`,
        cancelLabel: 'Не создавать',
      })
      // Отказ оставляет правило выключенным: включать закончившееся некуда
      if (!backfill) return
    } else if (info.missed > 0) {
      backfill = await confirm({
        title: `За время паузы пропущено ${payments(info.missed)}`,
        message: info.dueToday
          ? 'Создать их сейчас или продолжить со следующего по расписанию? Сегодняшний платёж будет создан в любом случае.'
          : 'Создать их сейчас или продолжить со следующего по расписанию?',
        confirmLabel: `Создать ${info.missed}`,
        cancelLabel: 'Не создавать',
      })
    }

    try {
      // Досоздание происходит здесь же, поэтому в тосте настоящее число,
      // а не обещание: перезапускать приложение не нужно
      const created = await recurringRepository.setActive(recurring.id, true, today, { backfill })
      if (created === 0) {
        toast.show('Регулярная операция включена')
      } else {
        toast.show(`Создано ${payments(created)}${info.finished ? ', расписание закончилось' : ''}`)
      }
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Не удалось включить', { tone: 'error' })
    }
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
            text="Добавьте аренду, подписку, зарплату или ежемесячный перевод на накопительный — они будут записываться сами."
            action={<Button onClick={() => setSheet({ kind: 'create' })}>Добавить</Button>}
          />
        </div>
      )}

      {items && items.length > 0 && data && (
        <>
          <ListCard label="Регулярные операции">
            {items.map((item) => (
              <ListItem key={item.id}>
                <ListRow
                  icon={iconFor(item, data.categories)}
                  title={titleFor(item, data.categories, data.accounts)}
                  subtitle={subtitleFor(item, today)}
                  value={
                    <span className={styles.amount} data-type={item.type} data-off={!item.isActive || undefined}>
                      {amountFor(item, data.settings.baseCurrency)}
                    </span>
                  }
                  onClick={() => setSheet({ kind: 'edit', id: item.id })}
                />
              </ListItem>
            ))}
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
              <>
                <div className={styles.toggle}>
                  <div>
                    <p className={styles.toggleTitle}>{current.isActive ? 'Активна' : 'Отключена'}</p>
                    <p className={styles.toggleHint}>
                      {current.isActive
                        ? `Следующая ${formatFutureDay(current.nextOccurrence, today).toLowerCase()}`
                        : 'Новые операции не создаются'}
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => void toggleActive(current)}>
                    {current.isActive ? 'Отключить' : 'Включить'}
                  </Button>
                </div>

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
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}

function iconFor(item: RecurringTransaction, categories: readonly Category[]): string {
  if (isRecurringTransfer(item)) return TRANSFER_ICON
  return categories.find((category) => category.id === item.categoryId)?.icon ?? MISSING_CATEGORY.icon
}

function titleFor(item: RecurringTransaction, categories: readonly Category[], accounts: readonly Account[]): string {
  const note = item.note.trim()
  if (note) return note

  if (isRecurringTransfer(item)) {
    const name = (id: Id) => accounts.find((account) => account.id === id)?.name ?? 'Удалённый счёт'
    return `${name(item.fromAccountId)} → ${name(item.toAccountId)}`
  }
  return categories.find((category) => category.id === item.categoryId)?.name ?? MISSING_CATEGORY.name
}

function amountFor(item: RecurringTransaction, currency: Parameters<typeof Money.format>[1]): string {
  // У перевода знака нет: деньги не приходят и не уходят
  if (isRecurringTransfer(item)) return Money.format(item.amount, currency)
  return Money.format(item.type === 'expense' ? -item.amount : item.amount, currency, { sign: 'always' })
}

function subtitleFor(item: RecurringTransaction, today: IsoDate): string {
  const schedule = describeRecurrence(item.frequency, item.interval)
  if (!item.isActive) return `${schedule} · отключена`
  return `${schedule} · следующая ${formatFutureDay(item.nextOccurrence, today).toLowerCase()}`
}
