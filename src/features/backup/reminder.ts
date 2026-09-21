import type { AppSettings } from '../../types/entities'
import { formatDayLabel, toIsoDate } from '../../utils/dates'

const DAY = 86_400_000

/**
 * Напоминание о резервной копии.
 *
 * Данные живут только на устройстве: сломался телефон — потеряно всё. Но и
 * назойливости здесь быть не должно, поэтому напоминание появляется редко и
 * только когда есть что терять.
 */

/** Пока операций меньше, терять почти нечего — напоминание только мешало бы. */
export const REMINDER_MIN_TRANSACTIONS = 15

/** Столько дней проходит между напоминаниями. */
export const REMINDER_INTERVAL_DAYS = 30

/** На столько откладывает кнопка «Позже». */
export const REMINDER_SNOOZE_DAYS = 7

export function shouldRemindBackup(settings: AppSettings, transactionCount: number, now: number): boolean {
  if (transactionCount < REMINDER_MIN_TRANSACTIONS) return false

  const snoozedUntil = settings.backupReminderSnoozedUntil
  if (snoozedUntil !== null && snoozedUntil > now) return false

  // Копий не было ни разу — напоминаем, как только накопились операции
  if (settings.lastBackupAt === null) return true

  return now - settings.lastBackupAt >= REMINDER_INTERVAL_DAYS * DAY
}

/** До какого момента отложить напоминание кнопкой «Позже». */
export function snoozeUntil(now: number): number {
  return now + REMINDER_SNOOZE_DAYS * DAY
}

/** «Сегодня», «Вчера», «20 сентября» или «Ещё не сохраняли». */
export function describeLastBackup(lastBackupAt: number | null, now: number): string {
  if (lastBackupAt === null) return 'Ещё не сохраняли'
  // Копия из будущего — след переведённых часов, а не ошибка: показываем «Сегодня»
  const at = Math.min(lastBackupAt, now)
  return formatDayLabel(toIsoDate(new Date(at)), toIsoDate(new Date(now)))
}
