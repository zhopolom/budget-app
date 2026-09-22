import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { useConfirm } from '../../components/Confirm/confirmContext'
import { useToast } from '../../components/Toast/toastContext'
import { toCsv, UTF8_BOM } from '../../features/backup/csv'
import { describeShareOutcome, exportBackupFile } from '../../features/backup/export'
import { backupFileName, countBackup, type BackupCounts } from '../../features/backup/format'
import { parseBackup } from '../../features/backup/parse'
import { describeLastBackup } from '../../features/backup/reminder'
import { resetAllData, restoreBackup } from '../../features/backup/repository'
import { accountsRepository } from '../../features/accounts/repository'
import { categoriesRepository } from '../../features/categories/repository'
import { settingsRepository } from '../../features/settings/repository'
import { transactionsRepository } from '../../features/transactions/repository'
import { toTransactionViews } from '../../features/transactions/views'
import { readFileAsText, shareOrDownloadTextFile } from '../../utils/download'
import { pluralRu } from '../../utils/plural'
import styles from './SettingsPage.module.css'

export function DataSection() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const lastBackup = useLiveQuery(
    async () => describeLastBackup((await settingsRepository.get()).lastBackupAt, Date.now()),
    [],
  )

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
      const message = describeShareOutcome(await exportBackupFile(new Date(), __APP_VERSION__))
      if (message) toast.show(message)
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

      const outcome = await shareOrDownloadTextFile(csv, backupFileName(new Date(), 'csv'), 'text/csv')
      if (outcome === 'shared') toast.show('Таблица готова — выберите, куда сохранить')
      else if (outcome === 'downloaded') toast.show('CSV выгружен')
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
          ? ` В копии ${parsed.danglingReferences} ${pluralRu(parsed.danglingReferences, ['запись ссылается', 'записи ссылаются', 'записей ссылаются'])} на удалённые счета или категории. Они не потеряются: операции переедут на «Восстановленный счёт», а регулярные платежи переедут туда же и будут выключены.`
          : ''),
      confirmLabel: 'Восстановить',
      tone: 'danger',
    })
    if (!confirmed) return

    const repaired = await restoreBackup(parsed.data)
    // Дата последней копии — дата самого файла: напоминание не должно
    // всплывать сразу после восстановления, но и врать про «сегодня» незачем
    await settingsRepository.update({
      lastBackupAt: parsed.exportedAt ?? Date.now(),
      backupReminderSnoozedUntil: null,
    })
    toast.show('Копия восстановлена')

    // Про выключенные расписания говорим отдельно: полоса на главной
    // рассказывает только про операции, а молча остановленный платёж —
    // ровно то, что пользователь заметит через месяц и не поймёт
    if (repaired.recurring > 0) {
      toast.show(
        `${repaired.recurring} ${pluralRu(repaired.recurring, ['регулярная операция ссылалась', 'регулярные операции ссылались', 'регулярных операций ссылались'])} на удалённый счёт — они выключены, выберите им счёт`,
      )
    }
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
          {/* undefined — настройки ещё читаются: лучше пустое место, чем «Ещё не сохраняли» на миг */}
          <ListRow icon="🗓️" title="Последняя копия" value={lastBackup} />
        </ListItem>
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
        // Поле служебное: открывается строкой «Восстановить из копии»,
        // поэтому из фокуса и скринридера его убираем
        tabIndex={-1}
        aria-hidden="true"
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
