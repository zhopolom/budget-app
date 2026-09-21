import { db } from '../../db/database'
import type { Account, CurrencyCode, Id } from '../../types/entities'
import { createId } from '../../utils/id'
import { Money } from '../../utils/money'
import { SETTINGS_ID } from '../settings/defaults'
import type { AccountInput } from './validation'

/**
 * Правило удаления счетов:
 * операции никогда не удаляются каскадно. Счёт с операциями удаляется только
 * через transferAndRemove — после переноса всех операций на другой счёт.
 */
export const accountsRepository = {
  listAll(): Promise<Account[]> {
    return db.accounts.orderBy('createdAt').toArray()
  },

  async create(input: AccountInput, currency: CurrencyCode): Promise<Account> {
    const now = Date.now()
    const account: Account = { ...input, id: createId(), currency, createdAt: now, updatedAt: now }
    await db.accounts.add(account)
    return account
  },

  async update(id: Id, input: AccountInput): Promise<void> {
    const updated = await db.accounts.update(id, { ...input, updatedAt: Date.now() })
    if (updated === 0) throw new Error('Счёт не найден')
  },

  /** Удаляет счёт без операций. Если операции есть — ошибка, ничего не меняется. */
  async remove(id: Id): Promise<void> {
    await db.transaction('rw', db.accounts, db.transactions, db.settings, async () => {
      if ((await db.accounts.count()) <= 1) throw new Error('Нельзя удалить единственный счёт')

      // Проверка внутри той же транзакции: между подсчётом и удалением
      // никто не успеет добавить операцию на этот счёт
      const count = await db.transactions.where('accountId').equals(id).count()
      if (count > 0) throw new Error('На счёте есть операции — перенесите их на другой счёт')

      await db.accounts.delete(id)
      await replaceLastAccount(id, null)
    })
  },

  /**
   * Переносит все операции счёта на другой счёт и удаляет исходный.
   * Всё выполняется в одной транзакции Dexie: любая ошибка откатывает
   * и перенос, и удаление — половина операций на старом счёте остаться не может.
   *
   * Начальный остаток тоже переходит на целевой счёт: иначе его операции
   * окажутся без стартовой суммы, а общий баланс изменится.
   *
   * Возвращает число перенесённых операций.
   */
  async transferAndRemove(sourceId: Id, targetId: Id): Promise<number> {
    if (sourceId === targetId) throw new Error('Выберите другой счёт')

    return db.transaction('rw', db.accounts, db.transactions, db.settings, async () => {
      const [source, target] = await Promise.all([db.accounts.get(sourceId), db.accounts.get(targetId)])
      if (!source) throw new Error('Счёт не найден')
      if (!target) throw new Error('Счёт для переноса не найден')
      if (source.currency !== target.currency) throw new Error('Счета в разных валютах')

      const now = Date.now()
      const moved = await db.transactions
        .where('accountId')
        .equals(sourceId)
        .modify({ accountId: targetId, updatedAt: now })

      // Контрольная проверка перед удалением: исключение здесь откатит всё
      const left = await db.transactions.where('accountId').equals(sourceId).count()
      if (left !== 0) throw new Error('Перенос операций не завершён')

      await db.accounts.update(targetId, {
        initialBalance: Money.add(target.initialBalance, source.initialBalance),
        updatedAt: now,
      })
      await db.accounts.delete(sourceId)
      await replaceLastAccount(sourceId, targetId)

      return moved
    })
  },
}

/** Если удалённый счёт был «последним выбранным» — подставляем замену. */
async function replaceLastAccount(removedId: Id, replacementId: Id | null): Promise<void> {
  const settings = await db.settings.get(SETTINGS_ID)
  if (settings?.lastAccountId !== removedId) return

  const fallback = replacementId ?? (await db.accounts.orderBy('createdAt').first())?.id ?? null
  await db.settings.update(SETTINGS_ID, { lastAccountId: fallback })
}
