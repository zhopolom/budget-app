import { shareOrDownloadTextFile, type ShareOutcome } from '../../utils/download'
import { settingsRepository } from '../settings/repository'
import { backupFileName } from './format'
import { createBackup, serializeBackup } from './repository'

/**
 * Сохранить копию: собрать файл, отдать его пользователю и запомнить дату.
 *
 * Отсюда копию сохраняют и настройки, и напоминание на главной — дату
 * последней копии обе записывают одинаково.
 */
type Deliver = (content: string, fileName: string, mimeType: string) => Promise<ShareOutcome>

export async function exportBackupFile(
  now: Date,
  appVersion: string,
  /** Подменяется в тестах: настоящая отдача файла требует браузера. */
  deliver: Deliver = shareOrDownloadTextFile,
): Promise<ShareOutcome> {
  const backup = await createBackup(now, appVersion)
  const outcome = await deliver(serializeBackup(backup), backupFileName(now, 'json'), 'application/json')

  // Отменённое системное окно копией не считается: напоминание должно остаться
  if (outcome !== 'cancelled') {
    await settingsRepository.update({ lastBackupAt: now.getTime(), backupReminderSnoozedUntil: null })
  }

  return outcome
}

/** Сообщение после сохранения — разное у «Поделиться» и обычного скачивания. */
export function describeShareOutcome(outcome: ShareOutcome): string | null {
  if (outcome === 'cancelled') return null
  return outcome === 'shared' ? 'Копия готова — выберите, куда сохранить' : 'Копия сохранена'
}
