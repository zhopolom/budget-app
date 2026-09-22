import { useLiveQuery } from 'dexie-react-hooks'
import { FullScreenLayout } from '../../app/FullScreenLayout'
import { goBack, navigate, useSearchParam } from '../../app/navigation'
import { Button } from '../../components/Button/Button'
import { EmptyState } from '../../components/EmptyState/EmptyState'
import { useToast } from '../../components/Toast/toastContext'
import { TransactionForm } from '../../components/TransactionForm/TransactionForm'
import { transactionsRepository } from '../../features/transactions/repository'
import { pickDefaultAccountId, useTransactionEditorData } from '../../features/transactions/useTransactionEditorData'
import { draftFromTransaction, emptyDraft, type TransactionDraft } from '../../features/transactions/validation'
import { useToday } from '../../hooks/useToday'
import type { ManualTransactionType } from '../../types/entities'

const TYPES: readonly ManualTransactionType[] = ['expense', 'income', 'transfer']

function isTransactionType(value: string | null): value is ManualTransactionType {
  return value !== null && (TYPES as readonly string[]).includes(value)
}

export function AddTransactionPage() {
  const data = useTransactionEditorData()
  const today = useToday()
  const toast = useToast()
  // ?type=transfer — сразу перевод, ?copy=<id> — повтор существующей операции
  const requestedType = useSearchParam('type')
  const copyId = useSearchParam('copy')
  // undefined — ещё читаем, null — образца нет
  const source = useLiveQuery(async () => (copyId ? ((await transactionsRepository.get(copyId)) ?? null) : null), [copyId])

  const close = () => goBack('/')
  const isTransfer = requestedType === 'transfer' || source?.type === 'transfer'

  const buildInitial = (): TransactionDraft => {
    if (!data) return emptyDraft(null, today)
    // Повтор операции: всё то же самое, но сегодняшней датой. Корректировку не повторяют —
    // она результат сверки, а не трата
    if (source && source.type !== 'adjustment') return { ...draftFromTransaction(source), date: today }

    const base = emptyDraft(pickDefaultAccountId(data.accounts, data.settings.lastAccountId), today)
    return isTransactionType(requestedType) ? { ...base, type: requestedType } : base
  }

  // Пока читаем операцию-образец, форму не монтируем: иначе она стартует с пустого черновика
  const ready = data !== undefined && source !== undefined

  return (
    <FullScreenLayout title={isTransfer ? 'Новый перевод' : 'Новая операция'} onClose={close}>
      {ready && data.accounts.length === 0 && (
        <EmptyState
          icon="💳"
          title="Нет ни одного счёта"
          text="Создайте счёт — операции записываются на него."
          action={<Button onClick={() => navigate('/accounts', { replace: true })}>Создать счёт</Button>}
        />
      )}

      {ready && data.accounts.length > 0 && (
        <TransactionForm
          initial={buildInitial()}
          data={data}
          mode="create"
          // При повторе сумма уже заполнена — клавиатура только мешала бы
          autoFocusAmount={!source}
          onSubmit={async (input) => {
            await transactionsRepository.create(input)
            toast.show(input.type === 'transfer' ? 'Перевод выполнен' : 'Операция добавлена')
            close()
          }}
        />
      )}
    </FullScreenLayout>
  )
}
