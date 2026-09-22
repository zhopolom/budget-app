import { Component, useEffect, useState, type ReactNode } from 'react'
import { Button } from '../components/Button/Button'
import { useToast } from '../components/Toast/toastContext'
import { describeShareOutcome, exportBackupFile, type PreparedBackup } from '../features/backup/export'
import { createBackup, serializeBackup } from '../features/backup/repository'
import { recordCrash } from '../features/diagnostics/errors'
import styles from './ErrorBoundary.module.css'
import { navigate } from './navigation'

interface Props {
  children: ReactNode
}

interface State {
  failed: boolean
}

/**
 * Глобальная граница ошибок (ТЗ §77). Упавший экран не должен утащить за
 * собой приложение — и тем более данные: здесь ничего не очищается,
 * а копию можно сохранить прямо с этого экрана, пока база доступна.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    recordCrash('Экран не открылся', error)
  }

  private retry = () => this.setState({ failed: false })

  private home = () => {
    navigate('/', { replace: true })
    this.setState({ failed: false })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return <CrashScreen onRetry={this.retry} onHome={this.home} />
  }
}

function CrashScreen({ onRetry, onHome }: { onRetry: () => void; onHome: () => void }) {
  // Копия собирается заранее: между нажатием и «Поделиться» на iOS не должно быть await
  const [backup, setBackup] = useState<PreparedBackup | null | undefined>(undefined)
  const toast = useToast()

  useEffect(() => {
    let cancelled = false
    createBackup(new Date(), __APP_VERSION__)
      .then((file) => {
        if (!cancelled) setBackup({ content: serializeBackup(file), preparedAt: new Date() })
      })
      .catch((error: unknown) => {
        recordCrash('Копия с экрана ошибки', error)
        if (!cancelled) setBackup(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = () => {
    if (!backup) return
    void exportBackupFile(backup).then((outcome) => {
      const message = describeShareOutcome(outcome)
      if (message) toast.show(message.text, { tone: message.tone })
    })
  }

  return (
    <main className={styles.screen} role="alert">
      <p className={styles.icon} aria-hidden="true">
        🧯
      </p>
      <h1 className={styles.title}>Не удалось открыть этот экран.</h1>
      <p className={styles.text}>
        Данные на устройстве целы: ошибка в интерфейсе, а не в базе. Можно попробовать снова или вернуться на главную.
      </p>
      <div className={styles.actions}>
        <Button block onClick={onRetry}>
          Повторить
        </Button>
        <Button variant="secondary" block onClick={onHome}>
          На главную
        </Button>
        {backup && (
          <Button variant="ghost" block onClick={save}>
            Сохранить резервную копию
          </Button>
        )}
        {backup === null && <p className={styles.hint}>База сейчас недоступна — копию сохранить не получится.</p>}
      </div>
    </main>
  )
}
