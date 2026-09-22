import { useState } from 'react'
import { useSelectedMonth } from '../../app/selectedMonth'
import { Button } from '../../components/Button/Button'
import { useConfirm } from '../../components/Confirm/confirmContext'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { MonthSelector } from '../../components/MonthSelector/MonthSelector'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { Sheet } from '../../components/Sheet/Sheet'
import { useToast } from '../../components/Toast/toastContext'
import {
  describePlan,
  isSnapshotEmpty,
  planApplication,
  type ApplyMode,
  type BudgetSnapshot,
} from '../../features/budgets/apply'
import { budgetsRepository, categoryBudgetsRepository } from '../../features/budgets/repository'
import { templatesRepository } from '../../features/budgets/templatesRepository'
import { useToday } from '../../hooks/useToday'
import type { BudgetTemplate, Id, MinorUnits } from '../../types/entities'
import {
  formatMonthAccusative,
  formatMonthDative,
  formatMonthGenitive,
  formatMonthPrepositional,
  previousMonth,
} from '../../utils/dates'
import { Money } from '../../utils/money'
import { pluralRu } from '../../utils/plural'
import { AmountSheet } from './AmountSheet'
import styles from './BudgetsPage.module.css'
import { TemplateNameSheet, TemplateSheet } from './TemplateSheets'
import { useBudgetsData, type CategoryLimitRow } from './useBudgetsData'

type Editing = { kind: 'total' } | { kind: 'category'; categoryId: Id } | null

/** Откуда применяем бюджет: шаблон или прошлый месяц. */
type ApplySource = { kind: 'template'; template: BudgetTemplate } | { kind: 'previous' }

function snapshotOf(source: ApplySource, previous: BudgetSnapshot | null): BudgetSnapshot | null {
  if (source.kind === 'previous') return previous
  return { totalLimit: source.template.totalLimit, categoryLimits: source.template.categoryLimits }
}

function sourceTitle(source: ApplySource, monthGenitive: string): string {
  return source.kind === 'previous' ? `Бюджет ${monthGenitive}` : `Шаблон «${source.template.name}»`
}

export function BudgetsPage() {
  const today = useToday()
  const selection = useSelectedMonth(today)
  const data = useBudgetsData(selection.month)
  const [editing, setEditing] = useState<Editing>(null)
  const [openTemplate, setOpenTemplate] = useState<BudgetTemplate | null>(null)
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState<ApplySource | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const month = selection.month
  const editingRow = editing?.kind === 'category' ? data?.rows.find((row) => row.category.id === editing.categoryId) : undefined
  const knownCategories = new Set(data?.categories.map((category) => category.id) ?? [])

  const saveTotal = async (value: MinorUnits) => {
    await budgetsRepository.setForMonth(month, value)
    toast.show(value > 0 ? 'Бюджет сохранён' : 'Бюджет убран')
  }

  const saveCategory = async (categoryId: Id, value: MinorUnits, rollover: boolean) => {
    await categoryBudgetsRepository.set(month, categoryId, value, { rollover })
    toast.show(value > 0 ? 'Лимит сохранён' : 'Лимит убран')
  }

  const runApply = async (source: ApplySource, mode: ApplyMode) => {
    try {
      const plan =
        source.kind === 'template'
          ? await templatesRepository.applyToMonth(source.template.id, month, mode)
          : await templatesRepository.copyMonth(previousMonth(month), month, mode)
      setApplying(null)
      setOpenTemplate(null)
      const text = describePlan(plan, data?.currency ?? 'UAH')
      toast.show(text === '' ? 'Ничего не изменилось' : `${text}.`)
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Не удалось применить', { tone: 'error' })
    }
  }

  /** Пустой месяц заполняется сразу; если бюджет уже есть — сначала превью (ТЗ §36). */
  const startApply = (source: ApplySource) => {
    if (!data) return
    if (isSnapshotEmpty(data.current)) void runApply(source, 'replace')
    else setApplying(source)
  }

  const saveTemplate = async (name: string) => {
    await templatesRepository.createFromMonth(name, month)
    toast.show(`Шаблон «${name.trim()}» сохранён`)
  }

  const removeTemplate = async (template: BudgetTemplate) => {
    const confirmed = await confirm({
      title: 'Удалить шаблон?',
      message: `«${template.name}» исчезнет из списка. Бюджеты месяцев, к которым он применялся, останутся.`,
      confirmLabel: 'Удалить',
      tone: 'danger',
    })
    if (!confirmed) return
    await templatesRepository.remove(template.id)
    setOpenTemplate(null)
    toast.show('Шаблон удалён')
  }

  const applyingSnapshot = applying && data ? snapshotOf(applying, data.previous) : null
  const mergePlan = applyingSnapshot && data ? planApplication(applyingSnapshot, data.current, 'merge', knownCategories) : null
  const replacePlan = applyingSnapshot && data ? planApplication(applyingSnapshot, data.current, 'replace', knownCategories) : null

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

            {data.previous && (
              <Button variant="secondary" block onClick={() => startApply({ kind: 'previous' })}>
                Скопировать бюджет за {formatMonthAccusative(previousMonth(month))}
              </Button>
            )}

            <ListCard label="Категории расходов">
              {data.rows.map((row) => (
                <ListItem key={row.category.id}>
                  <ListRow
                    icon={row.category.icon}
                    title={row.category.name}
                    subtitle={subtitleFor(row, data.currency)}
                    value={row.limit > 0 ? Money.format(Money.add(row.limit, row.carry), data.currency) : '—'}
                    onClick={() => setEditing({ kind: 'category', categoryId: row.category.id })}
                  />
                </ListItem>
              ))}
            </ListCard>

            {!isSnapshotEmpty(data.current) && (
              <Button variant="secondary" block onClick={() => setSaving(true)}>
                Сохранить как шаблон
              </Button>
            )}
          </section>

          <section className={styles.section} aria-label="Шаблоны бюджета">
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Шаблоны</h2>
            </div>
            <p className={styles.note}>
              Шаблон запоминает общий бюджет и лимиты категорий, чтобы применять их к любому месяцу одним нажатием.
            </p>
            {data.templates.length > 0 && (
              <ListCard label="Шаблоны бюджета">
                {data.templates.map((template) => (
                  <ListItem key={template.id}>
                    <ListRow
                      icon="📋"
                      title={template.name}
                      subtitle={templateSubtitle(template, data.currency)}
                      chevron
                      onClick={() => setOpenTemplate(template)}
                    />
                  </ListItem>
                ))}
              </ListCard>
            )}
          </section>
        </>
      )}

      {data && (
        <>
          <TemplateSheet
            template={openTemplate}
            categories={data.categories}
            currency={data.currency}
            monthDative={formatMonthDative(month)}
            onApply={(template) => startApply({ kind: 'template', template })}
            onRemove={(template) => void removeTemplate(template)}
            onClose={() => setOpenTemplate(null)}
          />

          <TemplateNameSheet open={saving} onSave={saveTemplate} onClose={() => setSaving(false)} />

          <Sheet
            open={applying !== null}
            onClose={() => setApplying(null)}
            title={`Применить к ${formatMonthDative(month)}`}
          >
            {applying && mergePlan && replacePlan && (
              <div className={styles.preview}>
                <p className={styles.previewText}>
                  В {formatMonthPrepositional(month)} бюджет уже задан: {describeSnapshot(data.current, data.currency)}.{' '}
                  {sourceTitle(applying, formatMonthGenitive(previousMonth(month)))} можно добавить к нему или поставить вместо него.
                </p>
                <div className={styles.previewActions}>
                  <Button block onClick={() => void runApply(applying, 'merge')}>
                    Дополнить
                  </Button>
                  <p className={styles.previewHint}>{describePlan(mergePlan, data.currency) || 'Ничего не изменится'}</p>
                  <Button variant="secondary" block onClick={() => void runApply(applying, 'replace')}>
                    Заменить
                  </Button>
                  <p className={styles.previewHint}>{describePlan(replacePlan, data.currency) || 'Ничего не изменится'}</p>
                  <Button variant="ghost" block onClick={() => setApplying(null)}>
                    Отмена
                  </Button>
                </div>
              </div>
            )}
          </Sheet>

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
            label={`Лимит на ${formatMonthAccusative(month)}`}
            hint={
              editingRow && editingRow.spent > 0
                ? `Уже потрачено ${Money.format(editingRow.spent, data.currency)}. Пустое поле убирает лимит.`
                : 'Пустое поле убирает лимит.'
            }
            value={editingRow?.limit ?? 0}
            currency={data.currency}
            clearLabel="Убрать лимит"
            option={{
              label: 'Переносить остаток на следующий месяц',
              hint: 'Неизрасходованная часть лимита добавится к лимиту следующего месяца. Перерасход не переносится.',
              checked: editingRow?.rollover ?? false,
            }}
            onSave={(value, rollover) => (editingRow ? saveCategory(editingRow.category.id, value, rollover) : undefined)}
            onClose={() => setEditing(null)}
          />
        </>
      )}
    </div>
  )
}

/** «Общий 20 000 ₴ · 4 лимита» */
function templateSubtitle(template: BudgetTemplate, currency: Parameters<typeof Money.format>[1]): string {
  const parts: string[] = []
  if (template.totalLimit > 0) parts.push(`Общий ${Money.format(template.totalLimit, currency)}`)
  const count = template.categoryLimits.length
  if (count > 0) parts.push(`${count} ${pluralRu(count, ['лимит', 'лимита', 'лимитов'])}`)
  return parts.join(' · ')
}

/** «общий 15 000 ₴ и 3 лимита» — что уже есть в месяце. */
function describeSnapshot(snapshot: BudgetSnapshot, currency: Parameters<typeof Money.format>[1]): string {
  const parts: string[] = []
  if (snapshot.totalLimit > 0) parts.push(`общий ${Money.format(snapshot.totalLimit, currency)}`)
  const count = snapshot.categoryLimits.length
  if (count > 0) parts.push(`${count} ${pluralRu(count, ['лимит', 'лимита', 'лимитов'])}`)
  return parts.join(' и ')
}

function subtitleFor(row: CategoryLimitRow, currency: Parameters<typeof Money.format>[1]): string | undefined {
  if (row.limit === 0) return row.spent > 0 ? `Потрачено ${Money.format(row.spent, currency)}` : undefined
  const effective = Money.add(row.limit, row.carry)
  const remaining = Money.subtract(effective, row.spent)
  const parts = [
    remaining < 0 ? `+${Money.format(-remaining, currency)} сверх лимита` : `Потрачено ${Money.format(row.spent, currency)}`,
  ]
  // Перенос виден отдельно: «6 000 + 800» честнее, чем молчаливые 6 800
  if (row.carry > 0) parts.push(`${Money.format(row.limit, currency)} + ${Money.format(row.carry, currency)} перенос`)
  else if (row.rollover) parts.push('с переносом остатка')
  return parts.join(' · ')
}
