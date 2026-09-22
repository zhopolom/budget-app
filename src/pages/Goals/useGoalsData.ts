import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import { accountsRepository } from '../../features/accounts/repository'
import { calculateForecast } from '../../features/forecast/service'
import { goalsRepository } from '../../features/goals/repository'
import { buildGoalsProgress, type GoalProgress } from '../../features/goals/service'
import { pendingOccurrencesRepository } from '../../features/recurring/pending'
import { recurringRepository } from '../../features/recurring/repository'
import { settingsRepository } from '../../features/settings/repository'
import { calculateAccountBalances } from '../../features/transactions/calculations'
import { transactionsRepository } from '../../features/transactions/repository'
import type { Account, CurrencyCode, IsoDate, MinorUnits } from '../../types/entities'

export interface GoalsData {
  currency: CurrencyCode
  active: GoalProgress[]
  archived: GoalProgress[]
  accounts: Account[]
  /** Что остаётся после регулярных платежей до конца месяца (ТЗ §41). null — расписаний нет. */
  freeAfterRecurring: MinorUnits | null
}

async function loadGoalsData(today: IsoDate): Promise<GoalsData> {
  return db.transaction(
    'r',
    [db.savingsGoals, db.accounts, db.transactions, db.settings, db.recurringTransactions, db.pendingOccurrences],
    async () => {
      const [goals, accounts, transactions, settings, rules, pending] = await Promise.all([
        goalsRepository.listAll(),
        accountsRepository.listAll(),
        // Остатки счетов считаются по всей истории — иначе прогресс цели был бы неверным
        transactionsRepository.listAll(),
        settingsRepository.get(),
        recurringRepository.listAll(),
        pendingOccurrencesRepository.listPending(),
      ])

      const progress = buildGoalsProgress(goals, accounts, calculateAccountBalances(accounts, transactions), today)
      const hasRules = rules.some((rule) => rule.isActive)
      const forecast = hasRules
        ? calculateForecast({ today, accounts, transactions, rules, pending, monthlyLimit: null })
        : null

      return {
        currency: settings.baseCurrency,
        active: progress.filter((item) => !item.goal.isArchived),
        archived: progress.filter((item) => item.goal.isArchived),
        accounts,
        freeAfterRecurring: forecast ? forecast.projectedBalance : null,
      }
    },
  )
}

export function useGoalsData(today: IsoDate): GoalsData | undefined {
  return useLiveQuery(() => loadGoalsData(today), [today])
}
