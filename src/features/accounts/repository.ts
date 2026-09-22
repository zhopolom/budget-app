import { db } from '../../db/database'
import type { Account, CurrencyCode, Id, RecurringTransaction, Timestamp } from '../../types/entities'
import { createId } from '../../utils/id'
import { isNonNegativeMoneyAmount, Money } from '../../utils/money'
import { detachGoalsFromAccount } from '../goals/repository'
import { isSelfTransferRule } from '../recurring/model'
import { categoryRulesRepository } from '../rules/repository'
import { SETTINGS_ID } from '../settings/defaults'
import { calculateAccountBalances } from '../transactions/calculations'
import type { AccountInput } from './validation'

/** Что осталось после переноса операций на другой счёт. */
export interface TransferAndRemoveResult {
  movedTransactions: number
  movedRecurring: number
  /**
   * Регулярные переводы, у которых после переноса обе стороны свелись к одному
   * счёту. Такие выключаются: создавать переводы «внутри счёта» нельзя.
   */
  stoppedRecurring: RecurringTransaction[]
  /** Цели, которые были связаны с удалённым счётом: перевязаны или оставлены без счёта. */
  goals: number
}

/**
 * Что делать с целями накоплений удаляемого счёта (ТЗ §34): перевязать на
 * целевой счёт (только если он накопительный) или оставить без счёта — тогда
 * остаток удаляемого счёта записывается им как накопленное вручную.
 */
export type GoalsOnRemove = 'relink' | 'unlink'

export interface RemoveOptions {
  goals?: GoalsOnRemove
}

/** Последняя проверка перед записью: форма уже отсеяла мусор, но репозиторий вызывают не только формы. */
function assertInitialBalance(value: unknown): void {
  if (!isNonNegativeMoneyAmount(value)) throw new RangeError('Начальный остаток должен быть от 0 до допустимого максимума')
}

/**
 * Правило удаления счетов:
 * операции никогда не удаляются каскадно. Счёт с операциями или регулярными
 * платежами удаляется только через transferAndRemove — после переноса всего,
 * что на него ссылается.
 */
export const accountsRepository = {
  listAll(): Promise<Account[]> {
    return db.accounts.orderBy('createdAt').toArray()
  },

  get(id: Id): Promise<Account | undefined> {
    return db.accounts.get(id)
  },

  async create(input: AccountInput, currency: CurrencyCode): Promise<Account> {
    assertInitialBalance(input.initialBalance)
    const now = Date.now()
    const account: Account = { ...input, id: createId(), currency, createdAt: now, updatedAt: now }
    await db.accounts.add(account)
    return account
  },

  async update(id: Id, input: AccountInput): Promise<void> {
    assertInitialBalance(input.initialBalance)
    const updated = await db.accounts.update(id, { ...input, updatedAt: Date.now() })
    if (updated === 0) throw new Error('Счёт не найден')
  },

  /**
   * Сколько операций и регулярных платежей ссылается на счёт.
   * Правило считается, если счёт стоит в любом из трёх полей.
   */
  async countUsage(id: Id): Promise<{ transactions: number; recurring: number; goals: number }> {
    const [transactions, recurring, goals] = await Promise.all([
      countTransactionsOf(id),
      countRecurringOf(id),
      db.savingsGoals.where('linkedAccountId').equals(id).count(),
    ])
    return { transactions, recurring, goals }
  },

  /**
   * Удаляет счёт, на который не ссылаются операции и расписания. Иначе — ошибка,
   * ничего не меняется. Цели удалению не мешают: они остаются без счёта,
   * а его остаток становится их накопленным.
   */
  async remove(id: Id): Promise<void> {
    await db.transaction(
      'rw',
      [db.accounts, db.transactions, db.recurringTransactions, db.savingsGoals, db.categoryRules, db.settings],
      async () => {
        if ((await db.accounts.count()) <= 1) throw new Error('Нельзя удалить единственный счёт')

        // Проверка внутри той же транзакции: между подсчётом и удалением
        // никто не успеет добавить операцию на этот счёт
        const usage = await accountsRepository.countUsage(id)
        if (usage.transactions > 0) throw new Error('На счёте есть операции — перенесите их на другой счёт')
        if (usage.recurring > 0) {
          throw new Error('Счёт используется в регулярных операциях — выберите, куда их перенести')
        }

        const account = await db.accounts.get(id)
        if (!account) throw new Error('Счёт не найден')
        // Операций нет, поэтому остаток — это начальный остаток
        await detachGoalsFromAccount(id, { keepAmount: account.initialBalance }, Date.now())
        await categoryRulesRepository.replaceAccount(id, null)

        await db.accounts.delete(id)
        await replaceLastAccount(id, null)
      },
    )
  },

  /**
   * Переносит всё, что ссылается на счёт, — операции и регулярные платежи —
   * на другой счёт и удаляет исходный.
   *
   * Всё выполняется в одной транзакции Dexie: любая ошибка откатывает и
   * перенос, и удаление — половина операций на старом счёте остаться не может.
   *
   * Начальный остаток тоже переходит на целевой счёт: иначе его операции
   * окажутся без стартовой суммы, а общий баланс изменится.
   */
  async transferAndRemove(sourceId: Id, targetId: Id, options: RemoveOptions = {}): Promise<TransferAndRemoveResult> {
    if (sourceId === targetId) throw new Error('Выберите другой счёт')

    return db.transaction(
      'rw',
      [db.accounts, db.transactions, db.recurringTransactions, db.savingsGoals, db.categoryRules, db.settings],
      async () => {
        const [source, target] = await Promise.all([db.accounts.get(sourceId), db.accounts.get(targetId)])
        if (!source) throw new Error('Счёт не найден')
        if (!target) throw new Error('Счёт для переноса не найден')
        if (source.currency !== target.currency) throw new Error('Счета в разных валютах')

        const now = Date.now()

        // Цели — до переноса операций: остаток удаляемого счёта ещё можно посчитать
        const goalsMode: GoalsOnRemove = options.goals ?? (target.type === 'savings' ? 'relink' : 'unlink')
        if (goalsMode === 'relink' && target.type !== 'savings') {
          throw new Error('Цели можно связать только с накопительным счётом')
        }
        const sourceBalance = calculateAccountBalances([source], await listTransactionsOf(sourceId)).get(sourceId) ?? 0
        const goals = await detachGoalsFromAccount(
          sourceId,
          goalsMode === 'relink' ? { relinkTo: targetId, keepAmount: sourceBalance } : { keepAmount: sourceBalance },
          now,
        )

        const movedTransactions = await moveTransactions(sourceId, targetId, now)
        const { moved: movedRecurring, stopped } = await moveRecurring(sourceId, targetId, now)
        await categoryRulesRepository.replaceAccount(sourceId, targetId)

        // Контрольная проверка перед удалением: исключение здесь откатит всё
        const left = await accountsRepository.countUsage(sourceId)
        if (left.transactions !== 0 || left.recurring !== 0) throw new Error('Перенос операций не завершён')

        await db.accounts.update(targetId, {
          initialBalance: Money.add(target.initialBalance, source.initialBalance),
          updatedAt: now,
        })
        await db.accounts.delete(sourceId)
        await replaceLastAccount(sourceId, targetId)

        return { movedTransactions, movedRecurring, stoppedRecurring: stopped, goals }
      },
    )
  },
}

/** Операции счёта: расход и доход по accountId, перевод — по любой из сторон. */
function transactionsOf(accountId: Id) {
  return db.transactions
    .where('accountId')
    .equals(accountId)
    .or('fromAccountId')
    .equals(accountId)
    .or('toAccountId')
    .equals(accountId)
}

function countTransactionsOf(accountId: Id): Promise<number> {
  return transactionsOf(accountId).count()
}

function listTransactionsOf(accountId: Id) {
  return transactionsOf(accountId).toArray()
}

/** То же для регулярных операций: индексы по трём полям заведены в схеме v3. */
function countRecurringOf(accountId: Id): Promise<number> {
  return db.recurringTransactions
    .where('accountId')
    .equals(accountId)
    .or('fromAccountId')
    .equals(accountId)
    .or('toAccountId')
    .equals(accountId)
    .count()
}

/**
 * Переписывает ссылки на счёт во всех трёх полях операций.
 *
 * Перевод, обе стороны которого после переноса ведут на один счёт, остаётся в
 * истории как перевод «внутри счёта»: он и так даёт нулевой вклад в остаток,
 * а удалять операцию пользователя нельзя. Запрет from ≠ to касается только
 * ввода новых переводов, а не уже записанной истории.
 */
async function moveTransactions(sourceId: Id, targetId: Id, now: Timestamp): Promise<number> {
  const touched = new Set<Id>()

  await db.transactions
    .where('accountId')
    .equals(sourceId)
    .modify((transaction) => {
      if (transaction.type === 'transfer') return
      transaction.accountId = targetId
      transaction.updatedAt = now
      touched.add(transaction.id)
    })

  await db.transactions
    .where('fromAccountId')
    .equals(sourceId)
    .modify((transaction) => {
      if (transaction.type !== 'transfer') return
      transaction.fromAccountId = targetId
      transaction.updatedAt = now
      touched.add(transaction.id)
    })

  await db.transactions
    .where('toAccountId')
    .equals(sourceId)
    .modify((transaction) => {
      if (transaction.type !== 'transfer') return
      transaction.toAccountId = targetId
      transaction.updatedAt = now
      touched.add(transaction.id)
    })

  return touched.size
}

/**
 * То же для расписаний. Регулярный перевод, у которого обе стороны свелись к
 * одному счёту, выключается: в отличие от истории, он бы создавал новые
 * бессмысленные операции каждый месяц.
 */
async function moveRecurring(
  sourceId: Id,
  targetId: Id,
  now: Timestamp,
): Promise<{ moved: number; stopped: RecurringTransaction[] }> {
  const touched = new Set<Id>()

  await db.recurringTransactions
    .where('accountId')
    .equals(sourceId)
    .modify((rule) => {
      if (rule.type === 'transfer') return
      rule.accountId = targetId
      rule.updatedAt = now
      touched.add(rule.id)
    })

  await db.recurringTransactions
    .where('fromAccountId')
    .equals(sourceId)
    .modify((rule) => {
      if (rule.type !== 'transfer') return
      rule.fromAccountId = targetId
      rule.updatedAt = now
      touched.add(rule.id)
    })

  await db.recurringTransactions
    .where('toAccountId')
    .equals(sourceId)
    .modify((rule) => {
      if (rule.type !== 'transfer') return
      rule.toAccountId = targetId
      rule.updatedAt = now
      touched.add(rule.id)
    })

  // Смотрим только на перенесённые правила: чужой перевод внутри счёта,
  // который был здесь до этого удаления, выключать не за что
  const stopped: RecurringTransaction[] = []
  for (const id of touched) {
    const rule = await db.recurringTransactions.get(id)
    if (!rule || !isSelfTransferRule(rule) || !rule.isActive) continue

    await db.recurringTransactions.update(id, { isActive: false, updatedAt: now })
    stopped.push({ ...rule, isActive: false, updatedAt: now })
  }

  return { moved: touched.size, stopped }
}

/** Если удалённый счёт был «последним выбранным» — подставляем замену. */
async function replaceLastAccount(removedId: Id, replacementId: Id | null): Promise<void> {
  const settings = await db.settings.get(SETTINGS_ID)
  if (settings?.lastAccountId !== removedId) return

  const fallback = replacementId ?? (await db.accounts.orderBy('createdAt').first())?.id ?? null
  await db.settings.update(SETTINGS_ID, { lastAccountId: fallback })
}
