import { useState } from 'react'
import { Button } from '../components/Button/Button'
import styles from './DevTools.module.css'
import { resetDatabase, seedMockData } from './mockData'

export default function DevTools() {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true)
    try {
      await action()
      setStatus(done)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.panel} aria-label="Инструменты разработчика">
      <h2 className={styles.title}>Dev</h2>
      <div className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={() => run(seedMockData, 'Тестовые данные добавлены')}>
          Добавить тестовые данные
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => run(resetDatabase, 'База сброшена')}>
          Сбросить базу
        </Button>
      </div>
      {status && (
        <p className={styles.status} role="status">
          {status}
        </p>
      )}
    </section>
  )
}
