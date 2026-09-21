import type { ReactNode } from 'react'
import { BottomNavigation } from '../components/BottomNavigation/BottomNavigation'
import styles from './AppLayout.module.css'

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      {/* Очень мягкие пятна под контентом: на плоском фоне стекло не читается */}
      <div className="app-backdrop" aria-hidden="true" />
      <main className={styles.main}>{children}</main>
      <BottomNavigation />
    </div>
  )
}
