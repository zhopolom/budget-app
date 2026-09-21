import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Button } from '../../components/Button/Button'
import { useToast } from '../../components/Toast/toastContext'
import { ACCOUNT_TYPE_ICONS } from '../../features/accounts/labels'
import { accountsRepository } from '../../features/accounts/repository'
import type { AccountWithBalance } from '../../features/accounts/useAccountsOverview'
import { transactionsRepository } from '../../features/transactions/repository'
import type { Account, CurrencyCode, Id } from '../../types/entities'
import { Money } from '../../utils/money'
import { pluralRu } from '../../utils/plural'
import styles from './DeleteAccountPanel.module.css'

interface DeleteAccountPanelProps {
  account: Account
  /** Счета, на которые можно перенести операции. */
  candidates: readonly AccountWithBalance[]
  currency: CurrencyCode
  onCancel: () => void
  onDone: () => void
  /** Другого счёта нет — пользователь создаёт его и возвращается сюда. */
  onCreateAccount: () => void
}

const operationsLabel = (count: number) => `${count} ${pluralRu(count, ['операция', 'операции', 'операций'])}`

export function DeleteAccountPanel({ account, candidates, currency, onCancel, onDone, onCreateAccount }: DeleteAccountPanelProps) {
  const count = useLiveQuery(() => transactionsRepository.countByAccount(account.id), [account.id])
  const [chosenId, setChosenId] = useState<Id | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  if (count === undefined) return null

  // Единственный кандидат выбран сразу; если их несколько — выбор за пользователем.
  // Вычисляем на каждом рендере: только что созданный счёт приходит из живого
  // запроса позже, чем монтируется панель, и useState(initial) его бы не увидел
  const targetId = chosenId ?? (candidates.length === 1 ? candidates[0].account.id : null)
  const target = candidates.find((item) => item.account.id === targetId)?.account

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true)
    try {
      await action()
      onDone()
      toast.show(message)
    } catch (error) {
      setBusy(false)
      toast.show(error instanceof Error ? error.message : 'Не удалось удалить счёт', { tone: 'error' })
    }
  }

  // Некуда переносить: сначала нужен другой счёт
  if (candidates.length === 0) {
    return (
      <div className={styles.panel}>
        <p className={styles.text}>
          {count > 0
            ? `На счёте «${account.name}» ${operationsLabel(count)}. Удалить их вместе со счётом нельзя — их нужно перенести на другой счёт, а другого пока нет.`
            : `«${account.name}» — единственный счёт. Без счёта нельзя добавлять операции, поэтому сначала создайте другой.`}
        </p>
        <div className={styles.actions}>
          <Button block onClick={onCreateAccount}>
            Создать счёт
          </Button>
          <Button variant="ghost" block onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </div>
    )
  }

  // Операции исчезли, пока окно было открыто (например, их удалили) — переносить нечего
  if (count === 0) {
    return (
      <div className={styles.panel}>
        <p className={styles.text}>Операций на счёте «{account.name}» нет.</p>
        <div className={styles.actions}>
          <Button variant="destructive" block disabled={busy} onClick={() => run(() => accountsRepository.remove(account.id), 'Счёт удалён')}>
            Удалить счёт
          </Button>
          <Button variant="ghost" block onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <p className={styles.text}>
        На счёте «{account.name}» {operationsLabel(count)}. Чтобы сохранить финансовую историю, выберите счёт, на который их
        перенести.
      </p>

      <div className={styles.list} role="radiogroup" aria-label="Счёт для переноса операций">
        {candidates.map(({ account: candidate, balance }) => (
          <button
            key={candidate.id}
            type="button"
            role="radio"
            aria-checked={candidate.id === targetId}
            className={styles.option}
            onClick={() => setChosenId(candidate.id)}
          >
            <span className={styles.icon} aria-hidden="true">
              {ACCOUNT_TYPE_ICONS[candidate.type]}
            </span>
            <span className={styles.name}>{candidate.name}</span>
            <span className={styles.balance}>{Money.format(balance, currency)}</span>
            <span className={styles.check} aria-hidden="true" />
          </button>
        ))}
      </div>

      {account.initialBalance !== 0 && (
        <p className={styles.note}>
          Начальный остаток {Money.format(account.initialBalance, currency)} тоже перейдёт на выбранный счёт — общий баланс не
          изменится.
        </p>
      )}

      <div className={styles.actions}>
        <Button
          variant="destructive"
          block
          disabled={!target || busy}
          onClick={() =>
            target &&
            run(
              () => accountsRepository.transferAndRemove(account.id, target.id),
              `Операции перенесены на «${target.name}», счёт удалён`,
            )
          }
        >
          Перенести и удалить счёт
        </Button>
        <Button variant="ghost" block onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
      </div>
    </div>
  )
}
