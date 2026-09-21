import { memo } from 'react'
import { MISSING_CATEGORY } from '../../features/categories/defaults'
import { signedAmount } from '../../features/transactions/calculations'
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
  const { transaction, category } = view
  const icon = category?.icon ?? MISSING_CATEGORY.icon
  const name = category?.name ?? MISSING_CATEGORY.name
  const note = transaction.note.trim()

  const content = (
    <>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <div className={styles.main}>
        <span className={styles.name}>{name}</span>
        {note && <span className={styles.note}>{note}</span>}
      </div>
      <div className={styles.side}>
        <span className={styles.amount} data-type={transaction.type}>
          {Money.format(signedAmount(transaction), currency, { sign: 'always' })}
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
