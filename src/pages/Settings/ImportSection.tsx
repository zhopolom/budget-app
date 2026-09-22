import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { navigate } from '../../app/navigation'
import { useConfirm } from '../../components/Confirm/confirmContext'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { useToast } from '../../components/Toast/toastContext'
import { importRepository } from '../../features/import/repository'
import type { ImportHistory } from '../../types/entities'
import { formatDayLabel, toIsoDate } from '../../utils/dates'
import { pluralRu } from '../../utils/plural'
import styles from './SettingsPage.module.css'

const HISTORY_LIMIT = 5

function subtitleFor(item: ImportHistory, today: string): string {
  const parts = [
    `${formatDayLabel(toIsoDate(new Date(item.importedAt)), today)} · ${item.count} ${pluralRu(item.count, ['операция', 'операции', 'операций'])}`,
  ]
  if (item.rolledBackAt !== undefined) parts.push('отменён')
  return parts.join(' · ')
}

/** «Импорт из CSV» и история последних импортов с отменой (ТЗ §53–§54). */
export function ImportSection() {
  const history = useLiveQuery(() => importRepository.listHistory(), [])
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const today = toIsoDate(new Date())

  const rollback = async (item: ImportHistory) => {
    if (busy) return
    setBusy(true)
    try {
      const preview = await importRepository.rollbackPreview(item.id)
      if (preview.total === 0) {
        toast.show('Операций этого импорта уже нет')
        return
      }
      const includeModified =
        preview.modified > 0
          ? await confirm({
              title: `Удалить и ${preview.modified} ${pluralRu(preview.modified, ['изменённую операцию', 'изменённые операции', 'изменённых операций'])}?`,
              message: `Из ${preview.total} операций импорта «${item.fileName}» ${preview.modified} вы правили после импорта. Удалить их вместе с остальными или оставить?`,
              confirmLabel: 'Удалить все',
              cancelLabel: 'Оставить изменённые',
              tone: 'danger',
            })
          : false
      const confirmed =
        preview.modified > 0 ||
        (await confirm({
          title: 'Отменить импорт?',
          message: `${preview.total} ${pluralRu(preview.total, ['операция', 'операции', 'операций'])} из «${item.fileName}» будут удалены. Остальные операции не затрагиваются.`,
          confirmLabel: 'Отменить импорт',
          tone: 'danger',
        }))
      if (!confirmed) return

      const result = await importRepository.rollback(item.id, { includeModified })
      toast.show(
        result.kept > 0
          ? `Удалено ${result.deleted}, оставлено ${result.kept} ${pluralRu(result.kept, ['изменённая', 'изменённые', 'изменённых'])}`
          : `Импорт отменён: удалено ${result.deleted} ${pluralRu(result.deleted, ['операция', 'операции', 'операций'])}`,
      )
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Не удалось отменить импорт', { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Импорт</h2>
      <ListCard label="Импорт">
        <ListItem>
          <ListRow icon="📥" title="Импорт из CSV" subtitle="Выгрузка из банка или таблицы" chevron onClick={() => navigate('/import')} />
        </ListItem>
        {(history ?? []).slice(0, HISTORY_LIMIT).map((item) => (
          <ListItem key={item.id}>
            <ListRow
              icon={item.rolledBackAt !== undefined ? '↩️' : '🗂️'}
              title={item.fileName}
              subtitle={subtitleFor(item, today)}
              value={item.rolledBackAt === undefined ? 'Отменить импорт' : undefined}
              onClick={item.rolledBackAt === undefined ? () => void rollback(item) : undefined}
            />
          </ListItem>
        ))}
      </ListCard>
    </section>
  )
}
