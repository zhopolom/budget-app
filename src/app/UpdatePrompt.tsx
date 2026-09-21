import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '../components/Button/Button'
import { GlassSurface } from '../components/GlassSurface/GlassSurface'
import styles from './UpdatePrompt.module.css'

/**
 * Плашка «Доступно обновление».
 *
 * Регистрирует service worker и следит за появлением новой версии.
 * Перезагрузка только по кнопке: молча перезагрузить экран посреди
 * заполнения формы — потерять введённое.
 */
export function UpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [updating, setUpdating] = useState(false)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, worker) => setRegistration(worker ?? null),
  })

  // iOS держит PWA в фоне сутками: проверяем обновление при возврате в приложение
  useEffect(() => {
    if (!registration) return

    const check = () => {
      if (document.visibilityState === 'visible') void registration.update().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [registration])

  /**
   * Обычно страницу перезагружает сам workbox, когда новый воркер берёт над
   * ней управление. Но если вкладка ещё не управлялась воркером (первый запуск
   * до перезагрузки), события controllerchange не будет — и кнопка зависла бы
   * на «Обновляем…». Поэтому через пару секунд перезагружаемся сами: новый
   * воркер к этому моменту уже активирован и отдаст свежие файлы.
   */
  const apply = () => {
    setUpdating(true)
    void updateServiceWorker(true)
    window.setTimeout(() => window.location.reload(), 2500)
  }

  if (!needRefresh) return null

  return (
    <GlassSurface density="prominent" bordered className={styles.prompt} role="status">
      <div className={styles.text}>
        <p className={styles.title}>Доступно обновление</p>
        <p className={styles.hint}>Данные сохранятся</p>
      </div>
      <Button onClick={apply} disabled={updating}>
        {updating ? 'Обновляем…' : 'Обновить'}
      </Button>
    </GlassSurface>
  )
}
