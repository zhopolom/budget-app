import { useEffect, type ComponentType } from 'react'
import { AccountsPage } from '../pages/Accounts/AccountsPage'
import { AddTransactionPage } from '../pages/AddTransaction/AddTransactionPage'
import { AnalyticsPage } from '../pages/Analytics/AnalyticsPage'
import { BudgetsPage } from '../pages/Budgets/BudgetsPage'
import { CategoriesPage } from '../pages/Categories/CategoriesPage'
import { DashboardPage } from '../pages/Dashboard/DashboardPage'
import { EditTransactionPage } from '../pages/EditTransaction/EditTransactionPage'
import { RecurringPage } from '../pages/Recurring/RecurringPage'
import { SettingsPage } from '../pages/Settings/SettingsPage'
import { TransactionsPage } from '../pages/Transactions/TransactionsPage'
import { AppLayout } from './AppLayout'
import { navigate, usePath } from './navigation'

/** Экраны с нижней навигацией. */
const TAB_ROUTES: Record<string, ComponentType> = {
  '/': DashboardPage,
  '/transactions': TransactionsPage,
  '/analytics': AnalyticsPage,
  '/settings': SettingsPage,
  '/accounts': AccountsPage,
  '/categories': CategoriesPage,
  '/budgets': BudgetsPage,
  '/recurring': RecurringPage,
}

/** Полноэкранные экраны без нижней навигации. */
const FULLSCREEN_ROUTES: Record<string, ComponentType> = {
  '/add': AddTransactionPage,
  '/edit': EditTransactionPage,
}

function RedirectHome() {
  useEffect(() => navigate('/', { replace: true }), [])
  return null
}

export function AppRouter() {
  const path = usePath()

  const Fullscreen = FULLSCREEN_ROUTES[path]
  if (Fullscreen) return <Fullscreen />

  const Page = TAB_ROUTES[path]
  if (!Page) return <RedirectHome />

  return (
    <AppLayout>
      <Page />
    </AppLayout>
  )
}
