import { lazy, Suspense } from 'react'
import { navigate } from '../../app/navigation'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { SegmentedControl } from '../../components/SegmentedControl/SegmentedControl'
import { settingsRepository } from '../../features/settings/repository'
import { useSettings } from '../../features/settings/useSettings'
import type { ThemePreference } from '../../types/entities'
import styles from './SettingsPage.module.css'

// В production-сборку не попадает: import.meta.env.DEV заменяется на false
const DevTools = import.meta.env.DEV ? lazy(() => import('../../dev/DevTools')) : null

const THEME_OPTIONS = [
  { value: 'system', label: 'Как в системе' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
] as const satisfies readonly { value: ThemePreference; label: string }[]

export function SettingsPage() {
  const settings = useSettings()

  return (
    <div className={styles.page}>
      <PageHeader title="Настройки" />

      <ListCard label="Данные">
        <ListItem>
          <ListRow icon="💳" title="Счета" chevron onClick={() => navigate('/accounts')} />
        </ListItem>
        <ListItem>
          <ListRow icon="🏷️" title="Категории" chevron onClick={() => navigate('/categories')} />
        </ListItem>
      </ListCard>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Тема</h2>
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

      <p className={styles.version}>Версия {__APP_VERSION__}</p>
    </div>
  )
}
