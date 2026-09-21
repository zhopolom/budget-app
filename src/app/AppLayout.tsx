import type { ReactNode } from 'react'
import { BottomNavigation } from '../components/BottomNavigation/BottomNavigation'
import styles from './AppLayout.module.css'

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <main className={styles.main}>{children}</main>
      <BottomNavigation />
    </div>
  )
}
