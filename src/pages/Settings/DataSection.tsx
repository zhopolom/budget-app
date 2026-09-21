import { useRef, useState } from 'react'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { useConfirm } from '../../components/Confirm/confirmContext'
import { useToast } from '../../components/Toast/toastContext'
import { toCsv, UTF8_BOM } from '../../features/backup/csv'
import { backupFileName, countBackup, type BackupCounts } from '../../features/backup/format'
import { parseBackup } from '../../features/backup/parse'
import { createBackup, resetAllData, restoreBackup, serializeBackup } from '../../features/backup/repository'
import { accountsRepository } from '../../features/accounts/repository'
import { categoriesRepository } from '../../features/categories/repository'
import { settingsRepository } from '../../features/settings/repository'
import { transactionsRepository } from '../../features/transactions/repository'
import { toTransactionViews } from '../../features/transactions/views'
import { downloadTextFile, readFileAsText } from '../../utils/download'
import { pluralRu } from '../../utils/plural'
import styles from './SettingsPage.module.css'

export function DataSection() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Не удалось выполнить', { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const saveBackup = () =>
    run(async () => {
      const now = new Date()
      const backup = await createBackup(now, __APP_VERSION__)
      downloadTextFile(serializeBackup(backup), backupFileName(now, 'json'), 'application/json')
      toast.show('Копия сохранена')
    })

  const exportCsv = () =>
    run(async () => {
      const [transactions, categories, accounts, settings] = await Promise.all([
        transactionsRepository.listAll(),
        categoriesRepository.listAll(),
        accountsRepository.listAll(),
        settingsRepository.get(),
      ])

      if (transactions.length === 0) {
        toast.show('Операций пока нет', { tone: 'error' })
        return
      }

      // По возрастанию даты: так таблицу читают как журнал операций
      const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
      const csv = UTF8_BOM + toCsv(toTransactionViews(sorted, categories, accounts), settings.baseCurrency)

      downloadTextFile(csv, backupFileName(new Date(), 'csv'), 'text/csv')
      toast.show('CSV выгружен')
    })

  const pickFile = () => {
    if (busy) return
    fileInput.current?.click()
  }

  const handleFile = async (file: File) => {
    const text = await readFileAsText(file)
    const parsed = parseBackup(text)

    if (!parsed.ok) {
      toast.show(parsed.error, { tone: 'error' })
      return
    }

    const counts = countBackup(parsed.data)
    const confirmed = await confirm({
      title: 'Восстановить из копии?',
      message:
        `${describeCounts(counts)}. Текущие данные на устройстве будут заменены.` +
        (parsed.schemaVersion < 2 ? ' Копия старого формата будет обновлена автоматически.' : '') +
        (parsed.danglingReferences > 0
          ? ` В копии ${parsed.danglingReferences} ${pluralRu(parsed.danglingReferences, ['операция ссылается', 'операции ссылаются', 'операций ссылаются'])} на удалённые счета или категории — они сохранятся как есть.`
          : ''),
      confirmLabel: 'Восстановить',
      tone: 'danger',
    })
    if (!confirmed) return

    await restoreBackup(parsed.data)
    toast.show('Копия восстановлена')
  }

  const reset = () =>
    run(async () => {
      const confirmed = await confirm({
        title: 'Удалить все данные?',
        message: 'Счета, операции, категории и настройки будут стёрты с устройства. Это действие нельзя отменить.',
        confirmLabel: 'Удалить всё',
        tone: 'danger',
      })
      if (!confirmed) return

      await resetAllData()
      toast.show('Данные удалены')
      // База пересоздана — перезагружаем, чтобы живые запросы не держали старый снимок
      window.location.reload()
    })

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Данные</h2>

      <ListCard label="Данные">
        <ListItem>
          <ListRow icon="💾" title="Сохранить копию" subtitle="JSON со всеми данными" onClick={saveBackup} />
        </ListItem>
        <ListItem>
          <ListRow icon="📥" title="Восстановить из копии" subtitle="Заменит данные на устройстве" onClick={pickFile} />
        </ListItem>
        <ListItem>
          <ListRow icon="📄" title="Экспорт в CSV" subtitle="Операции для таблиц" onClick={exportCsv} />
        </ListItem>
        <ListItem>
          <ListRow icon="🗑️" title="Удалить все данные" onClick={reset} />
        </ListItem>
      </ListCard>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Сбрасываем значение: иначе повторный выбор того же файла не сработает
          event.target.value = ''
          if (file) void run(() => handleFile(file))
        }}
      />
    </section>
  )
}

function describeCounts({ accounts, categories, transactions, recurringTransactions }: BackupCounts): string {
  const parts = [
    `${transactions} ${pluralRu(transactions, ['операция', 'операции', 'операций'])}`,
    `${accounts} ${pluralRu(accounts, ['счёт', 'счёта', 'счетов'])}`,
    `${categories} ${pluralRu(categories, ['категория', 'категории', 'категорий'])}`,
  ]
  if (recurringTransactions > 0) {
    parts.push(
      `${recurringTransactions} ${pluralRu(recurringTransactions, ['регулярная операция', 'регулярные операции', 'регулярных операций'])}`,
    )
  }
  return `В копии ${parts.join(', ')}`
}
