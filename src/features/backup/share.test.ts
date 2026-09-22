import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTestDatabase } from '../../test/db'
import { shareOrDownloadTextFile, type ShareOutcome } from '../../utils/download'
import { settingsRepository } from '../settings/repository'
import { describeShareOutcome, exportBackupFile } from './export'

/**
 * Главный риск экспорта на iPhone: в установленном PWA скачивание часто никуда
 * не сохраняет файл. Если считать такую попытку копией, приложение перестанет
 * напоминать о резервной копии, которой у человека нет.
 */

const NOW = new Date(2026, 8, 22, 12)

interface FakeNavigator {
  share?: (data: unknown) => Promise<void>
  canShare?: (data: unknown) => boolean
  standalone?: boolean
}

const originalNavigator = globalThis.navigator
const originalUserAgent = originalNavigator?.userAgent

function useNavigator(fake: FakeNavigator): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: originalUserAgent ?? '', ...fake },
    configurable: true,
    writable: true,
  })
}

function abortError(): DOMException {
  return new DOMException('Share canceled', 'AbortError')
}

function notAllowedError(): DOMException {
  return new DOMException('Must be handling a user gesture', 'NotAllowedError')
}

/** Скачивание требует DOM, которого в node-окружении нет. */
function stubDownload(): { called: () => number } {
  let called = 0
  const anchor = { href: '', download: '', rel: '', click: () => {}, remove: () => {} }

  Object.defineProperty(globalThis, 'document', {
    value: {
      createElement: () => {
        called += 1
        return anchor
      },
      body: { appendChild: () => {} },
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'URL', {
    value: { ...URL, createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'window', {
    value: { setTimeout: () => 0 },
    configurable: true,
    writable: true,
  })

  return { called: () => called }
}

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true, writable: true })
  vi.unstubAllGlobals()
})

describe('shareOrDownloadTextFile', () => {
  it('успешное «Поделиться» ничего не скачивает', async () => {
    const download = stubDownload()
    useNavigator({ canShare: () => true, share: async () => {} })

    expect(await shareOrDownloadTextFile('{}', 'backup.json', 'application/json')).toBe('shared')
    expect(download.called()).toBe(0)
  })

  it('закрытую шторку не считает ни копией, ни ошибкой', async () => {
    const download = stubDownload()
    useNavigator({ canShare: () => true, share: async () => { throw abortError() } })

    expect(await shareOrDownloadTextFile('{}', 'backup.json', 'application/json')).toBe('cancelled')
    expect(download.called()).toBe(0)
  })

  it('в браузере падение share возвращает скачивание', async () => {
    const download = stubDownload()
    useNavigator({ canShare: () => true, share: async () => { throw notAllowedError() }, standalone: false })

    expect(await shareOrDownloadTextFile('{}', 'backup.json', 'application/json')).toBe('downloaded')
    expect(download.called()).toBe(1)
  })

  it('в установленном PWA на iOS падение share — это неудача, а не копия', async () => {
    // Скачивание здесь бесполезно: файл некуда положить, а напоминание исчезнет
    const download = stubDownload()
    useNavigator({ canShare: () => true, share: async () => { throw notAllowedError() }, standalone: true })

    expect(await shareOrDownloadTextFile('{}', 'backup.json', 'application/json')).toBe('failed')
    expect(download.called()).toBe(0)
  })

  it('вызывает share в том же синхронном такте, что и нажатие', async () => {
    let microtaskRan = false
    queueMicrotask(() => {
      microtaskRan = true
    })

    let sawMicrotask: boolean | null = null
    useNavigator({
      canShare: () => true,
      share: async () => {
        sawMicrotask = microtaskRan
      },
    })

    // Микрозадача, поставленная до вызова, не должна успеть выполниться:
    // Safari отклоняет share, если жест пользователя уже закончился
    const promise = shareOrDownloadTextFile('{}', 'backup.json', 'application/json')
    expect(sawMicrotask).toBe(false)
    await promise
  })
})

describe('exportBackupFile', () => {
  beforeEach(resetTestDatabase)

  const prepared = { content: '{"app":"budget"}', preparedAt: NOW }
  const deliver = (outcome: ShareOutcome) => async () => outcome

  it('записывает дату копии после успешного «Поделиться»', async () => {
    expect(await exportBackupFile(prepared, deliver('shared'))).toBe('shared')
    expect((await settingsRepository.get()).lastBackupAt).toBe(NOW.getTime())
  })

  it('не записывает дату, если пользователь закрыл шторку', async () => {
    expect(await exportBackupFile(prepared, deliver('cancelled'))).toBe('cancelled')
    expect((await settingsRepository.get()).lastBackupAt).toBe(null)
  })

  it('не записывает дату, если «Поделиться» не открылось', async () => {
    expect(await exportBackupFile(prepared, deliver('failed'))).toBe('failed')
    expect((await settingsRepository.get()).lastBackupAt).toBe(null)
  })

  it('отдаёт готовое содержимое и имя файла по дате подготовки', async () => {
    let captured: { content: string; fileName: string } | null = null

    await exportBackupFile(prepared, async (content, fileName) => {
      captured = { content, fileName }
      return 'downloaded'
    })

    expect(captured).toEqual({ content: prepared.content, fileName: 'budget-backup-2026-09-22.json' })
  })

  it('не читает базу перед отдачей файла: копия готова заранее', async () => {
    // Любое чтение IndexedDB — это await, после которого Safari уже не считает
    // вызов ответом на нажатие. Поэтому deliver должен быть вызван синхронно
    let microtaskRan = false
    queueMicrotask(() => {
      microtaskRan = true
    })

    let sawMicrotask: boolean | null = null
    void exportBackupFile(prepared, async () => {
      sawMicrotask = microtaskRan
      return 'shared'
    })

    expect(sawMicrotask).toBe(false)
  })
})

describe('describeShareOutcome', () => {
  it('говорит о том, что уже произошло, а не о том, что произойдёт', () => {
    expect(describeShareOutcome('shared')).toEqual({ text: 'Копия отправлена', tone: 'default' })
    expect(describeShareOutcome('downloaded')).toEqual({ text: 'Копия скачана', tone: 'default' })
    expect(describeShareOutcome('cancelled')).toBe(null)
    expect(describeShareOutcome('failed')).toEqual({
      text: 'Не удалось открыть «Поделиться». Попробуйте ещё раз',
      tone: 'error',
    })
  })
})
