import { isIosStandalone } from './platform'

/**
 * Сохранение файла из приложения. Данные не уходят никуда за пределы
 * устройства: Blob создаётся в памяти, ссылка живёт доли секунды.
 */
export function downloadTextFile(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()

  // Safari успевает начать скачивание синхронно, но отзыв откладываем на всякий случай
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed'

/**
 * Отдаёт файл пользователю: на iPhone — системным «Поделиться», иначе обычным
 * скачиванием. В PWA на iOS ссылка со скачиванием часто открывает файл во
 * вкладке вместо сохранения, и копию попросту некуда положить.
 *
 * ВАЖНО: до вызова navigator.share в этой функции не должно появиться ни
 * одного await. Safari принимает share только пока жив жест пользователя, а
 * любая асинхронная пауза — чтение базы, ожидание сети — этот жест заканчивает,
 * и вызов отклоняется с NotAllowedError. Поэтому содержимое файла приходит
 * сюда готовым, а File и canShare — синхронные.
 *
 * Файл собирается в памяти устройства, никуда сам по себе не отправляется:
 * что с ним делать — «Сохранить в файлы», почта, мессенджер — решает человек
 * в системном окне.
 */
export async function shareOrDownloadTextFile(
  content: string,
  fileName: string,
  mimeType: string,
): Promise<ShareOutcome> {
  const file = new File([content], fileName, { type: `${mimeType};charset=utf-8` })
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })

  if (canShare) {
    try {
      await navigator.share({ files: [file], title: fileName })
      return 'shared'
    } catch (error) {
      // Пользователь закрыл системное окно — это не ошибка
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // Всё остальное — повод попробовать скачивание, если от него есть толк
      if (isIosStandalone()) return 'failed'
    }
  } else if (isIosStandalone()) {
    // Скачивание в установленном приложении на iOS файл никуда не сохранит.
    // Лучше честно сказать «не получилось», чем зачесть несуществующую копию
    return 'failed'
  }

  downloadTextFile(content, fileName, mimeType)
  return 'downloaded'
}

/** Читает выбранный файл как текст. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.readAsText(file, 'utf-8')
  })
}
