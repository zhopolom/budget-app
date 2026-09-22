import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Button } from '../../components/Button/Button'
import { useToast } from '../../components/Toast/toastContext'
import { ACCOUNT_TYPE_ICONS } from '../../features/accounts/labels'
import { accountsRepository, type GoalsOnRemove } from '../../features/accounts/repository'
import type { AccountWithBalance } from '../../features/accounts/useAccountsOverview'
import type { Account, CurrencyCode, Id, MinorUnits } from '../../types/entities'
import { Money } from '../../utils/money'
import { pluralRu } from '../../utils/plural'
import styles from './DeleteAccountPanel.module.css'

interface DeleteAccountPanelProps {
  account: Account
  /** Текущий остаток счёта — его запомнят цели, которые останутся без счёта. */
  balance: MinorUnits
  /** Счета, на которые можно перенести операции. */
  candidates: readonly AccountWithBalance[]
  currency: CurrencyCode
  onCancel: () => void
  onDone: () => void
  /** Другого счёта нет — пользователь создаёт его и возвращается сюда. */
  onCreateAccount: () => void
}

/** «12 операций и 2 регулярных платежа» — оба вида ссылок в одной фразе. */
function usageLabel({ transactions, recurring }: { transactions: number; recurring: number }): string {
  const parts: string[] = []
  if (transactions > 0) parts.push(`${transactions} ${pluralRu(transactions, ['операция', 'операции', 'операций'])}`)
  if (recurring > 0) {
    parts.push(
      `${recurring} ${pluralRu(recurring, ['регулярный платёж', 'регулярных платежа', 'регулярных платежей'])}`,
    )
  }
  return parts.join(' и ')
}

export function DeleteAccountPanel({ account, balance, candidates, currency, onCancel, onDone, onCreateAccount }: DeleteAccountPanelProps) {
  const usage = useLiveQuery(() => accountsRepository.countUsage(account.id), [account.id])
  const [chosenId, setChosenId] = useState<Id | null>(null)
  const [goalsChoice, setGoalsChoice] = useState<GoalsOnRemove | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  if (!usage) return null
  const used = usage.transactions + usage.recurring

  // Единственный кандидат выбран сразу; если их несколько — выбор за пользователем.
  // Вычисляем на каждом рендере: только что созданный счёт приходит из живого
  // запроса позже, чем монтируется панель, и useState(initial) его бы не увидел
  const targetId = chosenId ?? (candidates.length === 1 ? candidates[0].account.id : null)
  const target = candidates.find((item) => item.account.id === targetId)?.account

  // Цели удаляемого счёта (ТЗ §34): перевязать можно только на накопительный счёт,
  // иначе они остаются без счёта и запоминают его остаток как накопленное
  const canRelink = target?.type === 'savings'
  const goalsMode: GoalsOnRemove = goalsChoice && (goalsChoice === 'unlink' || canRelink) ? goalsChoice : canRelink ? 'relink' : 'unlink'
  const goalsLabel = `${usage.goals} ${pluralRu(usage.goals, ['цель накоплений', 'цели накоплений', 'целей накоплений'])}`

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

  const transferAndRemove = async (targetId: Id, targetName: string) => {
    setBusy(true)
    try {
      const result = await accountsRepository.transferAndRemove(account.id, targetId, { goals: goalsMode })
      onDone()
      toast.show(`Перенесено на «${targetName}», счёт удалён`)
      if (result.goals > 0) {
        toast.show(goalsMode === 'relink' ? `Цели связаны со счётом «${targetName}»` : 'Цели остались без счёта, накопленное сохранено')
      }

      // Регулярный перевод, у которого обе стороны свелись к одному счёту,
      // продолжал бы создавать бессмысленные операции — он выключен
      for (const stopped of result.stoppedRecurring) {
        toast.show(`Регулярный перевод «${stopped.note.trim() || 'без названия'}» остановлен: оба счёта совпали`)
      }
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
          {used > 0
            ? `На счёте «${account.name}» ${usageLabel(usage)}. Удалить вместе со счётом нельзя — нужно перенести на другой счёт, а другого пока нет.`
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

  // Ссылок не осталось (например, операции удалили, пока окно было открыто) — переносить нечего
  if (used === 0) {
    return (
      <div className={styles.panel}>
        <p className={styles.text}>На счёт «{account.name}» не ссылаются ни операции, ни регулярные платежи.</p>
        {usage.goals > 0 && (
          <p className={styles.note}>
            {goalsLabel} останется без счёта: накопленное {Money.format(balance, currency)} сохранится, а сама цель — нет
            смысла её удалять вместе со счётом.
          </p>
        )}
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
        На счёте «{account.name}» {usageLabel(usage)}. Чтобы сохранить финансовую историю, выберите счёт, на который всё
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

      {usage.goals > 0 && (
        <div className={styles.goals} role="radiogroup" aria-label="Что сделать с целями накоплений">
          <p className={styles.note}>Со счётом связано {goalsLabel}.</p>
          {canRelink && target && (
            <button
              type="button"
              role="radio"
              aria-checked={goalsMode === 'relink'}
              className={styles.option}
              onClick={() => setGoalsChoice('relink')}
            >
              <span className={styles.name}>Связать с «{target.name}»</span>
              <span className={styles.check} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            role="radio"
            aria-checked={goalsMode === 'unlink'}
            className={styles.option}
            onClick={() => setGoalsChoice('unlink')}
          >
            <span className={styles.name}>Оставить без счёта · накоплено {Money.format(balance, currency)}</span>
            <span className={styles.check} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className={styles.actions}>
        <Button
          variant="destructive"
          block
          disabled={!target || busy}
          onClick={() => target && void transferAndRemove(target.id, target.name)}
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
