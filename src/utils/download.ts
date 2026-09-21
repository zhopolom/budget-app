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

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled'

/**
 * Отдаёт файл пользователю: на iPhone — системным «Поделиться», иначе обычным
 * скачиванием. В PWA на iOS ссылка со скачиванием часто открывает файл во
 * вкладке вместо сохранения, и копию попросту некуда положить.
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

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName })
      return 'shared'
    } catch (error) {
      // Пользователь закрыл системное окно — это не ошибка
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // Всё остальное (share недоступен в этом контексте) — повод сохранить файлом
    }
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
