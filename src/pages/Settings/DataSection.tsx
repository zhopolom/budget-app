import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { useConfirm } from '../../components/Confirm/confirmContext'
import { useToast } from '../../components/Toast/toastContext'
import { describeShareOutcome, exportBackupFile } from '../../features/backup/export'
import { backupFileName, countBackup, type BackupCounts } from '../../features/backup/format'
import type { NormalizationSummary } from '../../features/backup/normalize'
import { parseBackup } from '../../features/backup/parse'
import { describeLastBackup } from '../../features/backup/reminder'
import { resetAllData, restoreBackup } from '../../features/backup/repository'
import { usePreparedBackup, usePreparedCsv } from '../../features/backup/usePreparedExport'
import { recordDiagnostic } from '../../features/diagnostics/journal'
import { settingsRepository } from '../../features/settings/repository'
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
  // Файлы собраны заранее: navigator.share на iOS принимается только пока
  // жив жест пользователя, а сборка — это чтение базы, то есть пауза
  const backup = usePreparedBackup(__APP_VERSION__)
  const csv = usePreparedCsv()

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

  // Обработчик не async до самой отдачи файла: между нажатием и
  // navigator.share не должно быть ни одного await
  const saveBackup = () => {
    if (busy || !backup) return
    void run(async () => {
      const outcome = await exportBackupFile(backup)
      if (outcome === 'failed') recordDiagnostic('Копия: «Поделиться» не открылось')

      const message = describeShareOutcome(outcome)
      if (message) toast.show(message.text, { tone: message.tone })
    })
  }

  const exportCsv = () => {
    if (busy || !csv) return
    if (csv.transactions === 0) {
      toast.show('Операций пока нет', { tone: 'error' })
      return
    }

    void run(async () => {
      const outcome = await shareOrDownloadTextFile(
        csv.content,
        backupFileName(csv.preparedAt, 'csv'),
        'text/csv',
      )
      if (outcome === 'shared') toast.show('Таблица отправлена')
      else if (outcome === 'downloaded') toast.show('CSV скачан')
      else if (outcome === 'failed') {
        recordDiagnostic('CSV: «Поделиться» не открылось')
        toast.show('Не удалось открыть «Поделиться». Попробуйте ещё раз', { tone: 'error' })
      }
    })
  }

  const pickFile = () => {
    if (busy) return
    fileInput.current?.click()
  }

  const handleFile = async (file: File) => {
    const text = await readFileAsText(file)
    const parsed = parseBackup(text)

    if (!parsed.ok) {
      // Подробности — только разработчику: в них id записей, но не суммы и не заметки
      if (parsed.details && import.meta.env.DEV) console.warn('Резервная копия отклонена:', parsed.details)
      if (parsed.details) recordDiagnostic(`Копия отклонена: ${parsed.error} (${parsed.details.length})`)
      toast.show(parsed.error, { tone: 'error' })
      return
    }

    const counts = countBackup(parsed.data)
    const confirmed = await confirm({
      title: 'Восстановить из копии?',
      message:
        `${describeCounts(counts)}. Текущие данные на устройстве будут заменены.` +
        (parsed.migrationSteps.length > 0
          ? ` Копия формата ${parsed.schemaVersion} будет обновлена до текущего автоматически: суммы и операции не меняются.`
          : '') +
        describeNormalization(parsed.normalization) +
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
          {/* Пока файл не собран, строка не нажимается: на реальных объёмах это доли секунды */}
          <ListRow
            icon="💾"
            title="Сохранить копию"
            subtitle={backup ? 'JSON со всеми данными' : 'Готовлю копию…'}
            onClick={backup ? saveBackup : undefined}
          />
        </ListItem>
        <ListItem>
          <ListRow icon="📥" title="Восстановить из копии" subtitle="Заменит данные на устройстве" onClick={pickFile} />
        </ListItem>
        <ListItem>
          <ListRow
            icon="📄"
            title="Экспорт в CSV"
            subtitle={csv ? 'Операции для таблиц' : 'Готовлю таблицу…'}
            onClick={csv ? exportCsv : undefined}
          />
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

/**
 * Что нормализация поменяет в копии. Говорим об этом до восстановления:
 * молча менять данные нельзя, даже когда это только код валюты.
 */
function describeNormalization({ currencies, lastAccountReset }: NormalizationSummary): string {
  const parts: string[] = []
  if (currencies > 0) {
    parts.push(
      ` У ${currencies} ${pluralRu(currencies, ['счёта', 'счетов', 'счетов'])} валюта отличается от основной — она будет заменена на основную. Суммы не пересчитываются: курсов у приложения нет.`,
    )
  }
  if (lastAccountReset) parts.push(' Счёт по умолчанию для новых операций будет выбран заново.')
  return parts.join('')
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
