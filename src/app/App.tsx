import { ConfirmProvider } from '../components/Confirm/ConfirmProvider'
import { ToastProvider } from '../components/Toast/ToastProvider'
import { useApplyTheme } from '../features/settings/theme'
import { useSettings } from '../features/settings/useSettings'
import { useKeyboardInset } from '../hooks/useKeyboardInset'
import { AppRouter } from './router'

export function App() {
  const settings = useSettings()
  useApplyTheme(settings?.theme)
  useKeyboardInset()

  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppRouter />
      </ConfirmProvider>
    </ToastProvider>
  )
}
