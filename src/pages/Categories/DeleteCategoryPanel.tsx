import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Button } from '../../components/Button/Button'
import { useToast } from '../../components/Toast/toastContext'
import { categoriesRepository } from '../../features/categories/repository'
import type { Category, Id } from '../../types/entities'
import { pluralRu } from '../../utils/plural'
import styles from './DeleteCategoryPanel.module.css'

interface DeleteCategoryPanelProps {
  category: Category
  /** Все категории того же типа, кроме удаляемой. */
  candidates: readonly Category[]
  onCancel: () => void
  onDone: () => void
}

export function DeleteCategoryPanel({ category, candidates, onCancel, onDone }: DeleteCategoryPanelProps) {
  const usage = useLiveQuery(() => categoriesRepository.countUsage(category.id), [category.id])
  const [chosenId, setChosenId] = useState<Id | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  if (!usage) return null

  const used = usage.transactions + usage.recurring
  // Единственный кандидат выбран сразу; при нескольких выбирает пользователь
  const targetId = chosenId ?? (candidates.length === 1 ? candidates[0].id : null)
  const target = candidates.find((item) => item.id === targetId)

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true)
    try {
      await action()
      onDone()
      toast.show(message)
    } catch (error) {
      setBusy(false)
      toast.show(error instanceof Error ? error.message : 'Не удалось удалить категорию', { tone: 'error' })
    }
  }

  if (used === 0) {
    return (
      <div className={styles.panel}>
        <p className={styles.text}>Категорию «{category.name}» никто не использует.</p>
        <div className={styles.actions}>
          <Button
            variant="destructive"
            block
            disabled={busy}
            onClick={() => run(() => categoriesRepository.remove(category.id), 'Категория удалена')}
          >
            Удалить категорию
          </Button>
          <Button variant="ghost" block onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </div>
    )
  }

  if (candidates.length === 0) {
    return (
      <div className={styles.panel}>
        <p className={styles.text}>
          На «{category.name}» ссылается {usageLabel(usage)}. Перенести их некуда — сначала создайте другую категорию
          этого типа.
        </p>
        <div className={styles.actions}>
          <Button variant="ghost" block onClick={onCancel}>
            Понятно
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <p className={styles.text}>
        На «{category.name}» ссылается {usageLabel(usage)}. Выберите категорию, на которую их перенести — без неё в
        истории остались бы операции без категории.
      </p>

      <div className={styles.list} role="radiogroup" aria-label="Категория для переноса">
        {candidates.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="radio"
            aria-checked={candidate.id === targetId}
            className={styles.option}
            onClick={() => setChosenId(candidate.id)}
          >
            <span className={styles.icon} aria-hidden="true">
              {candidate.icon}
            </span>
            <span className={styles.name}>{candidate.name}</span>
            <span className={styles.check} aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className={styles.actions}>
        <Button
          variant="destructive"
          block
          disabled={!target || busy}
          onClick={() =>
            target &&
            run(
              () => categoriesRepository.replaceAndRemove(category.id, target.id),
              `Операции перенесены в «${target.name}», категория удалена`,
            )
          }
        >
          Перенести и удалить
        </Button>
        <Button variant="ghost" block onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
      </div>
    </div>
  )
}

function usageLabel({ transactions, recurring }: { transactions: number; recurring: number }): string {
  const parts: string[] = []
  if (transactions > 0) {
    parts.push(`${transactions} ${pluralRu(transactions, ['операция', 'операции', 'операций'])}`)
  }
  if (recurring > 0) {
    parts.push(`${recurring} ${pluralRu(recurring, ['регулярная операция', 'регулярные операции', 'регулярных операций'])}`)
  }
  return parts.join(' и ')
}
