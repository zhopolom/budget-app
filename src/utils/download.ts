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

/** Читает выбранный файл как текст. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.readAsText(file, 'utf-8')
  })
}
