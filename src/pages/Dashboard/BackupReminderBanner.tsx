import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Banner } from '../../components/Banner/Banner'
import { Button } from '../../components/Button/Button'
import { useToast } from '../../components/Toast/toastContext'
import { db } from '../../db/database'
import { describeShareOutcome, exportBackupFile } from '../../features/backup/export'
import { REMINDER_INTERVAL_DAYS, shouldRemindBackup, snoozeUntil } from '../../features/backup/reminder'
import { usePreparedBackup } from '../../features/backup/usePreparedExport'
import { recordDiagnostic } from '../../features/diagnostics/journal'
import { settingsRepository } from '../../features/settings/repository'

/**
 * Напоминание сохранить копию. Данные лежат только на этом устройстве, и
 * единственная защита от потерянного телефона — файл, который человек сам
 * куда-то положил. Поэтому напоминаем, но редко и ненавязчиво.
 */
export function BackupReminderBanner() {
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  // Копия готовится заранее — иначе к моменту вызова share жест уже закончится
  const backup = usePreparedBackup(__APP_VERSION__)

  // Момент времени берём здесь, а не в рендере: запрос пересчитывается сам,
  // когда меняются настройки или число операций
  const state = useLiveQuery(async () => {
    const [settings, transactions] = await Promise.all([settingsRepository.get(), db.transactions.count()])
    return { settings, remind: shouldRemindBackup(settings, transactions, Date.now()) }
  }, [])

  if (!state?.remind) return null

  // До вызова navigator.share внутри exportBackupFile не должно быть ни одного
  // await: иначе Safari сочтёт жест законченным и шторку не откроет
  const save = async () => {
    if (busy || !backup) return
    setBusy(true)
    try {
      const outcome = await exportBackupFile(backup)
      if (outcome === 'failed') recordDiagnostic('Копия: «Поделиться» не открылось')

      const message = describeShareOutcome(outcome)
      if (message) toast.show(message.text, { tone: message.tone })
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Не удалось сохранить копию', { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const later = async () => {
    await settingsRepository.update({ backupReminderSnoozedUntil: snoozeUntil(Date.now()) })
  }

  return (
    <Banner
      icon="💾"
      tone="attention"
      title="Давно не было резервной копии"
      text={
        state.settings.lastBackupAt === null
          ? 'Данные хранятся только на этом устройстве. Сохраните копию — файл останется у вас.'
          : `С последней копии прошло больше ${REMINDER_INTERVAL_DAYS} дней. Данные хранятся только на этом устройстве.`
      }
      actions={
        <>
          <Button onClick={() => void save()} disabled={busy || !backup}>
            {backup ? 'Сохранить копию' : 'Готовлю копию…'}
          </Button>
          <Button variant="secondary" onClick={() => void later()} disabled={busy}>
            Позже
          </Button>
        </>
      }
    />
  )
}
