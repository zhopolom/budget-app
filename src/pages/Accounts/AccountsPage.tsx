import { useState } from 'react'
import { navigate } from '../../app/navigation'
import { Button } from '../../components/Button/Button'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { Sheet } from '../../components/Sheet/Sheet'
import { ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS } from '../../features/accounts/labels'
import { useAccountsOverview } from '../../features/accounts/useAccountsOverview'
import type { Account } from '../../types/entities'
import { Money } from '../../utils/money'
import { pluralRu } from '../../utils/plural'
import { AccountForm } from './AccountForm'
import styles from './AccountsPage.module.css'

export function AccountsPage() {
  const overview = useAccountsOverview()
  const [creating, setCreating] = useState(false)

  if (!overview) return null

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
        {overview.items.map(({ account, balance, count }) => (
          <ListItem key={account.id}>
            <ListRow
              icon={ACCOUNT_TYPE_ICONS[account.type]}
              title={account.name}
              subtitle={subtitleFor(account, count)}
              value={<span className={balance < 0 ? styles.negative : undefined}>{Money.format(balance, overview.currency)}</span>}
              chevron
              onClick={() => navigate(`/account?id=${encodeURIComponent(account.id)}`)}
            />
          </ListItem>
        ))}
      </ListCard>

      <Button variant="secondary" block onClick={() => setCreating(true)}>
        Добавить счёт
      </Button>

      <Sheet open={creating} onClose={() => setCreating(false)} title="Новый счёт">
        <AccountForm account={null} currency={overview.currency} onSaved={() => setCreating(false)} />
      </Sheet>
    </div>
  )
}

/** «Карта · 12 операций». Тип не дублируем, если он совпадает с названием. */
function subtitleFor(account: Account, count: number): string {
  const operations = `${count} ${pluralRu(count, ['операция', 'операции', 'операций'])}`
  const type = ACCOUNT_TYPE_LABELS[account.type]
  return account.name === type ? operations : `${type} · ${operations}`
}
