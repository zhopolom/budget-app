import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { FullScreenLayout } from '../../app/FullScreenLayout'
import { goBack, navigate, useSearchParam } from '../../app/navigation'
import { Button } from '../../components/Button/Button'
import { useConfirm } from '../../components/Confirm/confirmContext'
import { EmptyState } from '../../components/EmptyState/EmptyState'
import { useToast } from '../../components/Toast/toastContext'
import { TransactionForm } from '../../components/TransactionForm/TransactionForm'
import { describeTransaction } from '../../features/transactions/labels'
import { transactionsRepository } from '../../features/transactions/repository'
import { useTransactionEditorData } from '../../features/transactions/useTransactionEditorData'
import { draftFromTransaction } from '../../features/transactions/validation'
import { toTransactionViews } from '../../features/transactions/views'

export function EditTransactionPage() {
  const id = useSearchParam('id')
  const data = useTransactionEditorData()
  // undefined — загрузка, null — такой операции нет
  const transaction = useLiveQuery(async () => (id ? ((await transactionsRepository.get(id)) ?? null) : null), [id])
  const [closing, setClosing] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()

  const close = () => {
    // Не даём экрану мигнуть «Операция не найдена», пока идёт переход назад
    setClosing(true)
    goBack('/')
  }

  if (closing) return null

  const handleDelete = async () => {
    if (!transaction || !data) return
    const [view] = toTransactionViews([transaction], data.categories, data.accounts)

    const confirmed = await confirm({
      title: transaction.type === 'transfer' ? 'Удалить перевод?' : 'Удалить операцию?',
      message: `${describeTransaction(view, data.settings.baseCurrency)}. Это действие нельзя отменить.`,
      confirmLabel: 'Удалить',
      tone: 'danger',
    })
    if (!confirmed) return

    try {
      await transactionsRepository.remove(transaction.id)
      toast.show('Операция удалена')
      close()
    } catch {
      toast.show('Не удалось удалить операцию', { tone: 'error' })
    }
  }

  return (
    <FullScreenLayout title={transaction?.type === 'transfer' ? 'Перевод' : 'Операция'} onClose={close}>
      {transaction === null && (
        <EmptyState
          icon="🔍"
          title="Операция не найдена"
          text="Возможно, её уже удалили."
          action={<Button onClick={close}>Назад</Button>}
        />
      )}

      {transaction && data && (
        <TransactionForm
          key={transaction.id}
          initial={draftFromTransaction(transaction)}
          data={data}
          mode="edit"
          onSubmit={async (input) => {
            await transactionsRepository.update(transaction.id, input)
            toast.show('Операция изменена')
            close()
          }}
          onDuplicate={() => navigate(`/add?copy=${encodeURIComponent(transaction.id)}`, { replace: true })}
          onDelete={handleDelete}
        />
      )}
    </FullScreenLayout>
  )
}
