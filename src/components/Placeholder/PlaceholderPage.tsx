import { EmptyState } from '../EmptyState/EmptyState'
import { PageHeader } from '../PageHeader/PageHeader'
import styles from './PlaceholderPage.module.css'

interface PlaceholderPageProps {
  title: string
  icon: string
  text: string
}

/** Временная заглушка для экранов следующих этапов. */
export function PlaceholderPage({ title, icon, text }: PlaceholderPageProps) {
  return (
    <div className={styles.page}>
      <PageHeader title={title} />
      <div className={styles.card}>
        <EmptyState icon={icon} title="Экран в разработке" text={text} />
      </div>
    </div>
  )
}
