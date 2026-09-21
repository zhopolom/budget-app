import { navigate } from '../../app/navigation'
import type { TransactionView } from '../../features/transactions/views'
import type { CurrencyCode, Id } from '../../types/entities'
import { SwipeActions } from '../SwipeActions/SwipeActions'
import { TransactionItem } from './TransactionItem'

const openEditor = (id: Id) => navigate(`/edit?id=${encodeURIComponent(id)}`)
const openCopy = (id: Id) => navigate(`/add?copy=${encodeURIComponent(id)}`)

interface TransactionRowProps {
  view: TransactionView
  currency: CurrencyCode
  dayLabel?: string
}

/**
 * Строка операции со свайпами: влево — изменить, вправо — повторить (ТЗ §37).
 * Оба действия доступны и обычным путём: тап открывает редактирование,
 * «Повторить» есть там кнопкой. Свайп — ускорение, а не единственный путь.
 */
export function TransactionRow({ view, currency, dayLabel }: TransactionRowProps) {
  const id = view.transaction.id

  return (
    <SwipeActions
      left={{ label: 'Изменить', icon: '✏️', onAction: () => openEditor(id) }}
      right={{ label: 'Повторить', icon: '🔁', onAction: () => openCopy(id) }}
    >
      <TransactionItem view={view} currency={currency} dayLabel={dayLabel} onSelect={openEditor} />
    </SwipeActions>
  )
}
