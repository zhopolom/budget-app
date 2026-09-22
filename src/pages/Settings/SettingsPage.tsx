import { lazy, Suspense, useState } from 'react'
import { navigate } from '../../app/navigation'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { SegmentedControl } from '../../components/SegmentedControl/SegmentedControl'
import { isUnlocked, NO_TAPS, registerTap, tapHint } from '../../features/diagnostics/taps'
import { settingsRepository } from '../../features/settings/repository'
import { useSettings } from '../../features/settings/useSettings'
import type { ThemePreference } from '../../types/entities'
import { Money } from '../../utils/money'
import { CurrencySheet } from './CurrencySheet'
import { DataSection } from './DataSection'
import { ImportSection } from './ImportSection'
import styles from './SettingsPage.module.css'

// В production-сборку не попадает: import.meta.env.DEV заменяется на false
const DevTools = import.meta.env.DEV ? lazy(() => import('../../dev/DevTools')) : null

// Диагностика есть и в production, но грузится только когда её открыли
const DiagnosticsPanel = lazy(() => import('./DiagnosticsPanel'))

const THEME_OPTIONS = [
  { value: 'system', label: 'Как в системе' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
] as const satisfies readonly { value: ThemePreference; label: string }[]

export function SettingsPage() {
  const settings = useSettings()
  const [currencyOpen, setCurrencyOpen] = useState(false)
  const [taps, setTaps] = useState(NO_TAPS)
  const currency = settings?.baseCurrency ?? 'UAH'

  const diagnosticsOpen = isUnlocked(taps)
  const hint = tapHint(taps)

  return (
    <div className={styles.page}>
      <PageHeader title="Настройки" />

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Финансы</h2>
        <ListCard label="Финансы">
          <ListItem>
            <ListRow
              icon="💱"
              title="Валюта"
              value={`${Money.currencySymbol(currency)} ${currency}`}
              onClick={() => setCurrencyOpen(true)}
            />
          </ListItem>
          <ListItem>
            <ListRow icon="🎯" title="Бюджет и лимиты" chevron onClick={() => navigate('/budgets')} />
          </ListItem>
          <ListItem>
            <ListRow icon="🏁" title="Цели накоплений" chevron onClick={() => navigate('/goals')} />
          </ListItem>
          <ListItem>
            <ListRow icon="💳" title="Счета" chevron onClick={() => navigate('/accounts')} />
          </ListItem>
          <ListItem>
            <ListRow icon="🏷️" title="Категории" chevron onClick={() => navigate('/categories')} />
          </ListItem>
        </ListCard>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Автоматизация</h2>
        <ListCard label="Автоматизация">
          <ListItem>
            <ListRow icon="🔁" title="Регулярные операции" chevron onClick={() => navigate('/recurring')} />
          </ListItem>
          <ListItem>
            <ListRow icon="🏷️" title="Правила категорий" chevron onClick={() => navigate('/rules')} />
          </ListItem>
        </ListCard>
      </section>

      <ImportSection />

      <DataSection />

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Интерфейс</h2>
        <SegmentedControl
          options={THEME_OPTIONS}
          value={settings?.theme ?? 'system'}
          onChange={(theme) => void settingsRepository.update({ theme })}
          label="Тема оформления"
        />
      </section>

      <p className={styles.note}>Все данные хранятся только на этом устройстве.</p>

      {DevTools && (
        <Suspense fallback={null}>
          <DevTools />
        </Suspense>
      )}

      {diagnosticsOpen && (
        <Suspense fallback={null}>
          <DiagnosticsPanel onClose={() => setTaps(NO_TAPS)} />
        </Suspense>
      )}

      {/* Семь нажатий открывают диагностику. Обычному человеку кнопка не мешает:
          выглядит как подпись и ничего не делает */}
      <button
        type="button"
        className={styles.version}
        onClick={() => setTaps((current) => registerTap(current, Date.now()))}
      >
        Budget {__APP_VERSION__}
        {hint && <span className={styles.tapHint}> · {hint}</span>}
      </button>

      <CurrencySheet open={currencyOpen} value={currency} onClose={() => setCurrencyOpen(false)} />
    </div>
  )
}
