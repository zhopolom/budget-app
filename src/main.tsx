import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { installGlobalErrorJournal } from './features/diagnostics/errors'
import './styles/tokens.css'
import './styles/glass.css'
import './styles/global.css'

installGlobalErrorJournal()

// Просим браузер не вытеснять IndexedDB при нехватке места. Ответ не критичен.
void navigator.storage?.persist?.().catch(() => undefined)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
