import { beforeEach, describe, expect, it } from 'vitest'
import { resetTestDatabase } from '../../test/db'
import type { AppSettings } from '../../types/entities'
import { createDefaultSettings } from '../settings/defaults'
import { settingsRepository } from '../settings/repository'
import { exportBackupFile } from './export'
import {
  describeLastBackup,
  REMINDER_INTERVAL_DAYS,
  REMINDER_MIN_TRANSACTIONS,
  shouldRemindBackup,
  snoozeUntil,
} from './reminder'

const DAY = 86_400_000
/** Полдень по местному времени: сдвиг на сутки не перепрыгивает через дату. */
const NOW = new Date(2026, 8, 21, 12).getTime()

const settings = (patch: Partial<AppSettings> = {}): AppSettings => ({ ...createDefaultSettings(), ...patch })

describe('shouldRemindBackup', () => {
  it('молчит, пока операций мало', () => {
    expect(shouldRemindBackup(settings(), REMINDER_MIN_TRANSACTIONS - 1, NOW)).toBe(false)
  })

  it('напоминает, если копий не было ни разу', () => {
    expect(shouldRemindBackup(settings(), REMINDER_MIN_TRANSACTIONS, NOW)).toBe(true)
  })

  it('молчит сразу после сохранения копии', () => {
    expect(shouldRemindBackup(settings({ lastBackupAt: NOW - DAY }), 100, NOW)).toBe(false)
  })

  it('напоминает, когда с последней копии прошёл интервал', () => {
    const stale = settings({ lastBackupAt: NOW - REMINDER_INTERVAL_DAYS * DAY })
    expect(shouldRemindBackup(stale, 100, NOW)).toBe(true)

    const fresh = settings({ lastBackupAt: NOW - (REMINDER_INTERVAL_DAYS - 1) * DAY })
    expect(shouldRemindBackup(fresh, 100, NOW)).toBe(false)
  })

  it('«Позже» откладывает напоминание, но не отменяет его', () => {
    const snoozed = settings({ backupReminderSnoozedUntil: snoozeUntil(NOW) })

    expect(shouldRemindBackup(snoozed, 100, NOW)).toBe(false)
    expect(shouldRemindBackup(snoozed, 100, NOW + 6 * DAY)).toBe(false)
    expect(shouldRemindBackup(snoozed, 100, NOW + 8 * DAY)).toBe(true)
  })
})

describe('describeLastBackup', () => {
  it('называет дату по-человечески', () => {
    expect(describeLastBackup(null, NOW)).toBe('Ещё не сохраняли')
    expect(describeLastBackup(NOW - 60_000, NOW)).toBe('Сегодня')
    expect(describeLastBackup(NOW - DAY, NOW)).toBe('Вчера')
    expect(describeLastBackup(NOW - 10 * DAY, NOW)).toBe('11 сентября')
  })

  it('дату из будущего показывает как сегодняшнюю', () => {
    expect(describeLastBackup(NOW + 5 * DAY, NOW)).toBe('Сегодня')
  })
})

describe('exportBackupFile', () => {
  beforeEach(resetTestDatabase)

  it('запоминает дату копии и снимает откладывание', async () => {
    await settingsRepository.update({ backupReminderSnoozedUntil: NOW + 7 * DAY })
    const now = new Date(NOW)

    const outcome = await exportBackupFile(now, '0.3.0', async () => 'shared')

    expect(outcome).toBe('shared')
    const stored = await settingsRepository.get()
    expect(stored.lastBackupAt).toBe(NOW)
    expect(stored.backupReminderSnoozedUntil).toBe(null)
  })

  it('отменённое окно «Поделиться» копией не считается', async () => {
    const outcome = await exportBackupFile(new Date(NOW), '0.3.0', async () => 'cancelled')

    expect(outcome).toBe('cancelled')
    expect((await settingsRepository.get()).lastBackupAt).toBe(null)
  })

  it('отдаёт файл с именем по дате и разбираемым содержимым', async () => {
    let captured: { content: string; fileName: string; mimeType: string } | null = null

    await exportBackupFile(new Date(2026, 8, 21), '0.3.0', async (content, fileName, mimeType) => {
      captured = { content, fileName, mimeType }
      return 'downloaded'
    })

    expect(captured).not.toBeNull()
    const { content, fileName, mimeType } = captured!
    expect(fileName).toBe('budget-backup-2026-09-21.json')
    expect(mimeType).toBe('application/json')
    expect(JSON.parse(content).app).toBe('budget')
  })
})
