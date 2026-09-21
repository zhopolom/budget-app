import { useState } from 'react'
import { Button } from '../../components/Button/Button'
import { useConfirm } from '../../components/Confirm/confirmContext'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { Sheet } from '../../components/Sheet/Sheet'
import { useToast } from '../../components/Toast/toastContext'
import { transferCandidates } from '../../features/accounts/deletion'
import { ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS } from '../../features/accounts/labels'
import { accountsRepository } from '../../features/accounts/repository'
import { useAccountsOverview } from '../../features/accounts/useAccountsOverview'
import { transactionsRepository } from '../../features/transactions/repository'
import type { Account, Id } from '../../types/entities'
import { Money } from '../../utils/money'
import { AccountForm } from './AccountForm'
import styles from './AccountsPage.module.css'
import { DeleteAccountPanel } from './DeleteAccountPanel'

type SheetState =
  | { kind: 'closed' }
  /** resumeDeleteOf — после создания вернуться к удалению этого счёта. */
  | { kind: 'create'; resumeDeleteOf: Id | null }
  | { kind: 'edit'; accountId: Id }
  | { kind: 'delete'; accountId: Id }

const SHEET_TITLES = { create: 'Новый счёт', edit: 'Счёт', delete: 'Удаление счёта' } as const

export function AccountsPage() {
  const overview = useAccountsOverview()
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' })
  const confirm = useConfirm()
  const toast = useToast()

  if (!overview) return null

  const close = () => setSheet({ kind: 'closed' })

  // Счёт берём из живых данных: остатки в шторке обновляются, а удалённый счёт закрывает её сам
  const current =
    sheet.kind === 'edit' || sheet.kind === 'delete'
      ? overview.items.find((item) => item.account.id === sheet.accountId)?.account
      : undefined
  const isOpen = sheet.kind === 'create' || current !== undefined

  const startDelete = async (account: Account) => {
    const count = await transactionsRepository.countByAccount(account.id)

    // Операций нет и счёт не единственный — обычное подтверждение
    if (count === 0 && overview.items.length > 1) {
      const confirmed = await confirm({
        title: `Удалить счёт «${account.name}»?`,
        message:
          account.initialBalance !== 0
            ? `Операций на счёте нет. Начальный остаток ${Money.format(account.initialBalance, overview.currency)} уйдёт из общего баланса.`
            : 'Операций на счёте нет.',
        confirmLabel: 'Удалить',
        tone: 'danger',
      })
      if (!confirmed) return
      try {
        await accountsRepository.remove(account.id)
        close()
        toast.show('Счёт удалён')
      } catch (error) {
        toast.show(error instanceof Error ? error.message : 'Не удалось удалить счёт', { tone: 'error' })
      }
      return
    }

    // Есть операции (или счёт единственный) — перенос
    setSheet({ kind: 'delete', accountId: account.id })
  }

  const renderSheetContent = () => {
    if (sheet.kind === 'create') {
      return (
        <AccountForm
          account={null}
          currency={overview.currency}
          onSaved={() =>
            setSheet(sheet.resumeDeleteOf ? { kind: 'delete', accountId: sheet.resumeDeleteOf } : { kind: 'closed' })
          }
        />
      )
    }
    if (!current) return null

    if (sheet.kind === 'edit') {
      return (
        <AccountForm account={current} currency={overview.currency} onSaved={close} onDelete={() => void startDelete(current)} />
      )
    }

    return (
      <DeleteAccountPanel
        account={current}
        candidates={transferCandidates(current, overview.items)}
        currency={overview.currency}
        onCancel={() => setSheet({ kind: 'edit', accountId: current.id })}
        onDone={close}
        onCreateAccount={() => setSheet({ kind: 'create', resumeDeleteOf: current.id })}
      />
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Счета" backTo="/settings" />

      <div className={styles.total}>
        <p className={styles.totalLabel}>Всего на счетах</p>
        <p className={styles.totalValue} data-negative={overview.total < 0 || undefined}>
          {Money.format(overview.total, overview.currency)}
        </p>
      </div>

      <ListCard label="Счета">
        {overview.items.map(({ account, balance }) => (
          <ListItem key={account.id}>
            <ListRow
              icon={ACCOUNT_TYPE_ICONS[account.type]}
              title={account.name}
              // «Карта / Карта» выглядит как ошибка — тип показываем, только если он отличается от названия
              subtitle={account.name === ACCOUNT_TYPE_LABELS[account.type] ? undefined : ACCOUNT_TYPE_LABELS[account.type]}
              value={<span className={balance < 0 ? styles.negative : undefined}>{Money.format(balance, overview.currency)}</span>}
              onClick={() => setSheet({ kind: 'edit', accountId: account.id })}
            />
          </ListItem>
        ))}
      </ListCard>

      <Button variant="secondary" block onClick={() => setSheet({ kind: 'create', resumeDeleteOf: null })}>
        Добавить счёт
      </Button>

      <Sheet open={isOpen} onClose={close} title={sheet.kind === 'closed' ? '' : SHEET_TITLES[sheet.kind]}>
        {/* key: при смене режима внутри открытой шторки форма стартует заново */}
        <div key={sheet.kind === 'create' ? `create-${sheet.resumeDeleteOf}` : `${sheet.kind}-${current?.id}`}>
          {renderSheetContent()}
        </div>
      </Sheet>
    </div>
  )
}
