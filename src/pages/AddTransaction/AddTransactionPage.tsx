import { FullScreenLayout } from '../../app/FullScreenLayout'
import { goBack, navigate } from '../../app/navigation'
import { Button } from '../../components/Button/Button'
import { EmptyState } from '../../components/EmptyState/EmptyState'
import { useToast } from '../../components/Toast/toastContext'
import { TransactionForm } from '../../components/TransactionForm/TransactionForm'
import { transactionsRepository } from '../../features/transactions/repository'
import { pickDefaultAccountId, useTransactionEditorData } from '../../features/transactions/useTransactionEditorData'
import { useToday } from '../../hooks/useToday'

export function AddTransactionPage() {
  const data = useTransactionEditorData()
  const today = useToday()
  const toast = useToast()
  const close = () => goBack('/')

  return (
    <FullScreenLayout title="Новая операция" onClose={close}>
      {data && data.accounts.length === 0 && (
        <EmptyState
          icon="💳"
          title="Нет ни одного счёта"
          text="Создайте счёт — операции записываются на него."
          action={<Button onClick={() => navigate('/accounts', { replace: true })}>Создать счёт</Button>}
        />
      )}

      {data && data.accounts.length > 0 && (
        <TransactionForm
          initial={{
            type: 'expense',
            amountText: '',
            categoryId: null,
            accountId: pickDefaultAccountId(data.accounts, data.settings.lastAccountId),
            date: today,
            note: '',
          }}
          data={data}
          submitLabel="Добавить"
          autoFocusAmount
          onSubmit={async (input) => {
            await transactionsRepository.create(input)
            toast.show('Операция добавлена')
            close()
          }}
        />
      )}
    </FullScreenLayout>
  )
}
