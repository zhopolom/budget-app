import { useState } from 'react'
import { navigate, useSearchParam } from '../../app/navigation'
import { useSelectedMonth } from '../../app/selectedMonth'
import { Button } from '../../components/Button/Button'
import { EmptyState } from '../../components/EmptyState/EmptyState'
import { MonthSelector } from '../../components/MonthSelector/MonthSelector'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { Sheet } from '../../components/Sheet/Sheet'
import { TransactionRow } from '../../components/TransactionItem/TransactionRow'
import { transferCandidates } from '../../features/accounts/deletion'
import { ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS } from '../../features/accounts/labels'
import { useAccountsOverview } from '../../features/accounts/useAccountsOverview'
import { groupByDay } from '../../features/transactions/grouping'
import { useToday } from '../../hooks/useToday'
import type { MinorUnits } from '../../types/entities'
import { formatDayLabel, formatMonthGenitive } from '../../utils/dates'
import { Money } from '../../utils/money'
import { pluralRu } from '../../utils/plural'
import { AccountForm } from './AccountForm'
import styles from './AccountPage.module.css'
import { DeleteAccountPanel } from './DeleteAccountPanel'
import { ReconcileSheet } from './ReconcileSheet'
import { useAccountData } from './useAccountData'

type SheetMode = 'closed' | 'edit' | 'create' | 'delete' | 'reconcile'

const SHEET_TITLES: Record<SheetMode, string> = {
  closed: '',
  edit: 'Счёт',
  create: 'Новый счёт',
  delete: 'Удаление счёта',
  reconcile: 'Сверка остатка',
}

export function AccountPage() {
  const id = useSearchParam('id')
  const today = useToday()
  const selection = useSelectedMonth(today)
  const data = useAccountData(id, selection.month)
  const overview = useAccountsOverview()
  const [sheet, setSheet] = useState<SheetMode>('closed')

  const account = data?.account ?? null
  const groups = data ? groupByDay(data.views) : []

  return (
    <div className={styles.page}>
      <PageHeader title={account?.name ?? 'Счёт'} backTo="/accounts" />

      {data && !account && (
        <div className={styles.card}>
          <EmptyState
            icon="🔍"
            title="Счёт не найден"
            text="Возможно, его удалили."
            action={<Button onClick={() => navigate('/accounts', { replace: true })}>К счетам</Button>}
          />
        </div>
      )}

      {data && account && (
        <>
          <section className={styles.header} aria-label="Остаток на счёте">
            <span className={styles.icon} aria-hidden="true">
              {ACCOUNT_TYPE_ICONS[account.type]}
            </span>
            <p className={styles.type}>{ACCOUNT_TYPE_LABELS[account.type]}</p>
            <p className={styles.balance} data-negative={data.balance < 0 || undefined}>
              {Money.format(data.balance, data.currency)}
            </p>
            <p className={styles.count}>
              {data.totalCount} {pluralRu(data.totalCount, ['операция', 'операции', 'операций'])} за всё время
            </p>
            <div className={styles.headerActions}>
              <Button variant="secondary" onClick={() => setSheet('reconcile')}>
                Сверить баланс
              </Button>
              <Button variant="secondary" onClick={() => setSheet('edit')}>
                Изменить счёт
              </Button>
            </div>
          </section>

          <MonthSelector selection={selection} />

          <section className={styles.tiles} aria-label={`Обороты за ${formatMonthGenitive(selection.month)}`}>
            <Tile label="Доходы" value={data.activity.income} currency={data.currency} tone="positive" />
            <Tile label="Расходы" value={data.activity.expense} currency={data.currency} />
            <Tile label="Пришло переводом" value={data.activity.transferIn} currency={data.currency} />
            <Tile label="Ушло переводом" value={data.activity.transferOut} currency={data.currency} />
            {/* Корректировки редки — плитка появляется, только когда сверка что-то нашла */}
            {data.activity.adjustment !== 0 && (
              <Tile label="Корректировки" value={data.activity.adjustment} currency={data.currency} signed />
            )}
          </section>

          {groups.length === 0 ? (
            <div className={styles.card}>
              <EmptyState icon="🧾" title="В этом месяце операций по счёту не было" />
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.date} className={styles.day}>
                <h2 className={styles.dayTitle}>{formatDayLabel(group.date, today)}</h2>
                <ul className={styles.list}>
                  {group.items.map((view) => (
                    <li key={view.transaction.id}>
                      <TransactionRow view={view} currency={data.currency} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}

          <Sheet open={sheet !== 'closed'} onClose={() => setSheet('closed')} title={SHEET_TITLES[sheet]}>
            {/* key: при смене режима внутри открытой шторки форма стартует заново */}
            <div key={sheet}>
              {sheet === 'edit' && (
                <AccountForm
                  account={account}
                  currency={data.currency}
                  onSaved={() => setSheet('closed')}
                  onDelete={() => setSheet('delete')}
                />
              )}

              {sheet === 'create' && (
                <AccountForm
                  account={null}
                  currency={data.currency}
                  // Счёт создавали ради переноса — возвращаемся к удалению
                  onSaved={() => setSheet('delete')}
                />
              )}

              {sheet === 'reconcile' && (
                <ReconcileSheet
                  account={account}
                  current={data.balance}
                  currency={data.currency}
                  today={today}
                  onDone={() => setSheet('closed')}
                />
              )}

              {sheet === 'delete' && overview && (
                <DeleteAccountPanel
                  account={account}
                  balance={data.balance}
                  candidates={transferCandidates(account, overview.items)}
                  currency={data.currency}
                  onCancel={() => setSheet('edit')}
                  onDone={() => navigate('/accounts', { replace: true })}
                  onCreateAccount={() => setSheet('create')}
                />
              )}
            </div>
          </Sheet>
        </>
      )}
    </div>
  )
}

function Tile({
  label,
  value,
  currency,
  tone,
  signed = false,
}: {
  label: string
  value: MinorUnits
  currency: Parameters<typeof Money.format>[1]
  tone?: 'positive'
  /** Показывать знак: у корректировок он и есть смысл. */
  signed?: boolean
}) {
  return (
    <div className={styles.tile}>
      <p className={styles.tileLabel}>{label}</p>
      <p className={styles.tileValue} data-tone={value > 0 ? tone : undefined} data-zero={value === 0 || undefined}>
        {Money.format(value, currency, { sign: signed ? 'always' : 'auto' })}
      </p>
    </div>
  )
}
