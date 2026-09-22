import { shareOrDownloadTextFile, type ShareOutcome } from '../../utils/download'
import { settingsRepository } from '../settings/repository'
import { backupFileName } from './format'

/** Готовая к отдаче копия: содержимое собрано заранее, до нажатия кнопки. */
export interface PreparedBackup {
  content: string
  preparedAt: Date
}

type Deliver = (content: string, fileName: string, mimeType: string) => Promise<ShareOutcome>

/**
 * Отдать заранее собранную копию и запомнить дату.
 *
 * Копию сюда передают готовой намеренно: собрать её — значит прочитать
 * IndexedDB, а это await, после которого Safari уже не считает вызов
 * navigator.share ответом на нажатие. Сборка живёт в usePreparedBackup.
 *
 * Отсюда копию сохраняют и настройки, и напоминание на главной — дату
 * последней копии обе записывают одинаково.
 */
export async function exportBackupFile(
  prepared: PreparedBackup,
  /** Подменяется в тестах: настоящая отдача файла требует браузера. */
  deliver: Deliver = shareOrDownloadTextFile,
): Promise<ShareOutcome> {
  // Первым делом — deliver, без единого await перед ним
  const outcome = await deliver(
    prepared.content,
    backupFileName(prepared.preparedAt, 'json'),
    'application/json',
  )

  // Копией считается только то, что действительно дошло до пользователя:
  // иначе напоминание исчезнет, а копии у человека не будет
  if (outcome === 'shared' || outcome === 'downloaded') {
    await settingsRepository.update({
      lastBackupAt: prepared.preparedAt.getTime(),
      backupReminderSnoozedUntil: null,
    })
  }

  return outcome
}

export interface OutcomeMessage {
  text: string
  tone: 'default' | 'error'
}

/** Сообщение о том, что уже произошло. null — пользователь просто передумал. */
export function describeShareOutcome(outcome: ShareOutcome): OutcomeMessage | null {
  switch (outcome) {
    case 'shared':
      return { text: 'Копия отправлена', tone: 'default' }
    case 'downloaded':
      return { text: 'Копия скачана', tone: 'default' }
    case 'failed':
      return { text: 'Не удалось открыть «Поделиться». Попробуйте ещё раз', tone: 'error' }
    case 'cancelled':
      return null
  }
}
