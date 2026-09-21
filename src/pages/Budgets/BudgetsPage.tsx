import { useState } from 'react'
import { useSelectedMonth } from '../../app/selectedMonth'
import { Button } from '../../components/Button/Button'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { MonthSelector } from '../../components/MonthSelector/MonthSelector'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { useToast } from '../../components/Toast/toastContext'
import { budgetsRepository, categoryBudgetsRepository } from '../../features/budgets/repository'
import { useToday } from '../../hooks/useToday'
import type { Id, MinorUnits } from '../../types/entities'
import { formatMonthGenitive, previousMonth } from '../../utils/dates'
import { Money } from '../../utils/money'
import { pluralRu } from '../../utils/plural'
import { AmountSheet } from './AmountSheet'
import styles from './BudgetsPage.module.css'
import { useBudgetsData, type CategoryLimitRow } from './useBudgetsData'

type Editing = { kind: 'total' } | { kind: 'category'; categoryId: Id } | null

export function BudgetsPage() {
  const today = useToday()
  const selection = useSelectedMonth(today)
  const data = useBudgetsData(selection.month)
  const [editing, setEditing] = useState<Editing>(null)
  const toast = useToast()

  const month = selection.month
  const editingRow = editing?.kind === 'category' ? data?.rows.find((row) => row.category.id === editing.categoryId) : undefined

  const saveTotal = async (value: MinorUnits) => {
    await budgetsRepository.setForMonth(month, value)
    toast.show(value > 0 ? 'Бюджет сохранён' : 'Бюджет убран')
  }

  const saveCategory = async (categoryId: Id, value: MinorUnits) => {
    await categoryBudgetsRepository.set(month, categoryId, value)
    toast.show(value > 0 ? 'Лимит сохранён' : 'Лимит убран')
  }

  const copyPrevious = async () => {
    const copied = await categoryBudgetsRepository.copyFrom(previousMonth(month), month)
    toast.show(
      copied > 0
        ? `Перенесено ${copied} ${pluralRu(copied, ['лимит', 'лимита', 'лимитов'])}`
        : 'Переносить нечего',
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Бюджет" backTo="/settings" />
      <MonthSelector selection={selection} />

      {data && (
        <>
          <section className={styles.card} aria-label="Общий бюджет месяца">
            <p className={styles.cardLabel}>Общий бюджет {formatMonthGenitive(month)}</p>
            <p className={styles.cardValue}>
              {data.totalLimit > 0 ? Money.format(data.totalLimit, data.currency) : 'Не задан'}
            </p>
            <p className={styles.cardHint}>
              {data.totalLimit > 0
                ? `Потрачено ${Money.format(data.monthExpense, data.currency)}`
                : 'Общий лимит расходов на месяц. Лимиты категорий работают дополнительно.'}
            </p>
            <Button variant="secondary" onClick={() => setEditing({ kind: 'total' })} className={styles.cardAction}>
              {data.totalLimit > 0 ? 'Изменить' : 'Установить бюджет'}
            </Button>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Лимиты категорий</h2>
              {data.limitsTotal > 0 && (
                <span className={styles.sectionValue}>{Money.format(data.limitsTotal, data.currency)}</span>
              )}
            </div>

            <p className={styles.note}>
              Сумма лимитов не обязана совпадать с общим бюджетом — это отдельные ограничения.
            </p>

            {data.copyableFromPrevious > 0 && (
              <Button variant="secondary" block onClick={() => void copyPrevious()}>
                Перенести лимиты за {formatMonthGenitive(previousMonth(month))}
              </Button>
            )}

            <ListCard label="Категории расходов">
              {data.rows.map((row) => (
                <ListItem key={row.category.id}>
                  <ListRow
                    icon={row.category.icon}
                    title={row.category.name}
                    subtitle={subtitleFor(row, data.currency)}
                    value={row.limit > 0 ? Money.format(row.limit, data.currency) : '—'}
                    onClick={() => setEditing({ kind: 'category', categoryId: row.category.id })}
                  />
                </ListItem>
              ))}
            </ListCard>
          </section>
        </>
      )}

      {data && (
        <>
          <AmountSheet
            open={editing?.kind === 'total'}
            title={`Бюджет ${formatMonthGenitive(month)}`}
            label="Лимит расходов на месяц"
            hint="Пустое поле убирает бюджет этого месяца."
            value={data.totalLimit}
            currency={data.currency}
            clearLabel="Убрать бюджет"
            onSave={saveTotal}
            onClose={() => setEditing(null)}
          />

          <AmountSheet
            open={editingRow !== undefined}
            title={editingRow ? `${editingRow.category.icon} ${editingRow.category.name}` : ''}
            label={`Лимит на ${formatMonthGenitive(month)}`}
            hint={
              editingRow && editingRow.spent > 0
                ? `Уже потрачено ${Money.format(editingRow.spent, data.currency)}. Пустое поле убирает лимит.`
                : 'Пустое поле убирает лимит.'
            }
            value={editingRow?.limit ?? 0}
            currency={data.currency}
            clearLabel="Убрать лимит"
            onSave={(value) => (editingRow ? saveCategory(editingRow.category.id, value) : undefined)}
            onClose={() => setEditing(null)}
          />
        </>
      )}
    </div>
  )
}

function subtitleFor(row: CategoryLimitRow, currency: Parameters<typeof Money.format>[1]): string | undefined {
  if (row.limit === 0) return row.spent > 0 ? `Потрачено ${Money.format(row.spent, currency)}` : undefined
  const remaining = Money.subtract(row.limit, row.spent)
  return remaining < 0
    ? `+${Money.format(-remaining, currency)} сверх лимита`
    : `Потрачено ${Money.format(row.spent, currency)}`
}
