import { memo } from 'react'
import { transactionIcon, transactionTitle } from '../../features/transactions/labels'
import { isTransfer } from '../../features/transactions/model'
import type { TransactionView } from '../../features/transactions/views'
import type { CurrencyCode, Id } from '../../types/entities'
import { Money } from '../../utils/money'
import styles from './TransactionItem.module.css'

interface TransactionItemProps {
  view: TransactionView
  currency: CurrencyCode
  dayLabel: string
  /** Если задан — строка становится кнопкой. */
  onSelect?: (id: Id) => void
}

export const TransactionItem = memo(function TransactionItem({ view, currency, dayLabel, onSelect }: TransactionItemProps) {
  const { transaction } = view
  const note = transaction.note.trim()

  // У перевода знака нет: деньги не ушли и не пришли, а переложены между счетами
  const amount = isTransfer(transaction)
    ? Money.format(transaction.amount, currency)
    : Money.format(transaction.type === 'expense' ? -transaction.amount : transaction.amount, currency, {
        sign: 'always',
      })

  const content = (
    <>
      <span className={styles.icon} aria-hidden="true">
        {transactionIcon(view)}
      </span>
      <div className={styles.main}>
        <span className={styles.name}>{transactionTitle(view)}</span>
        {note && <span className={styles.note}>{note}</span>}
      </div>
      <div className={styles.side}>
        <span className={styles.amount} data-type={transaction.type}>
          {amount}
        </span>
        <span className={styles.date}>{dayLabel}</span>
      </div>
    </>
  )

  return onSelect ? (
    <button type="button" className={`${styles.item} ${styles.interactive}`} onClick={() => onSelect(transaction.id)}>
      {content}
    </button>
  ) : (
    <div className={styles.item}>{content}</div>
  )
})
