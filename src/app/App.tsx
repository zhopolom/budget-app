import { ConfirmProvider } from '../components/Confirm/ConfirmProvider'
import { ToastProvider } from '../components/Toast/ToastProvider'
import { useRecurringGeneration } from '../features/recurring/useRecurringGeneration'
import { useApplyTheme } from '../features/settings/theme'
import { useSettings } from '../features/settings/useSettings'
import { useKeyboardInset } from '../hooks/useKeyboardInset'
import { useToday } from '../hooks/useToday'
import { AppRouter } from './router'

export function App() {
  const settings = useSettings()
  useApplyTheme(settings?.theme)
  useKeyboardInset()

  return (
    <ToastProvider>
      <ConfirmProvider>
        <RecurringRunner />
        <AppRouter />
      </ConfirmProvider>
    </ToastProvider>
  )
}

/** Отдельный компонент: генерации нужен useToast, а он живёт внутри ToastProvider. */
function RecurringRunner() {
  useRecurringGeneration(useToday())
  return null
}
