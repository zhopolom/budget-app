import Dexie from 'dexie'
import { db } from '../../db/database'
import type { Id, IsoDate, RecurringTransaction, Transaction } from '../../types/entities'
import { addDaysIso } from '../../utils/dates'
import { createId } from '../../utils/id'
import { MAX_OCCURRENCES_PER_RUN, nextOccurrenceOnOrAfter, occurrencesBetween } from './occurrences'

/** Данные регулярной операции без служебных полей: nextOccurrence считается сам. */
export type RecurringInput = Omit<
  RecurringTransaction,
  'id' | 'nextOccurrence' | 'lastGeneratedAt' | 'createdAt' | 'updatedAt'
>

export interface GenerationResult {
  /** Сколько операций создано. */
  created: number
  /** Сколько расписаний сработало. */
  rules: number
  /** Расписания, которые закончились и были отключены. */
  finished: number
}

/** Даты уже созданных вхождений расписания — по составному индексу, без чтения операций. */
async function generatedDatesOf(recurringId: Id): Promise<Set<IsoDate>> {
  const keys = await db.transactions
    .where('[recurringId+occurrenceDate]')
    .between([recurringId, Dexie.minKey], [recurringId, Dexie.maxKey])
    .keys()

  // Ключ составного индекса приходит массивом [recurringId, occurrenceDate]
  return new Set(keys.map((key) => String((key as unknown as [Id, IsoDate])[1])))
}

export const recurringRepository = {
  /** Ближайшие по сроку — первыми. */
  listAll(): Promise<RecurringTransaction[]> {
    return db.recurringTransactions.orderBy('nextOccurrence').toArray()
  },

  get(id: Id): Promise<RecurringTransaction | undefined> {
    return db.recurringTransactions.get(id)
  },

  async create(input: RecurringInput, today: IsoDate): Promise<RecurringTransaction> {
    const now = Date.now()
    // Первое вхождение — не раньше начала расписания и не раньше сегодняшнего дня,
    // иначе создание правила задним числом сразу нарисовало бы гору операций
    const first = nextOccurrenceOnOrAfter(input, input.startDate > today ? input.startDate : today)
    const recurring: RecurringTransaction = {
      ...input,
      id: createId(),
      nextOccurrence: first ?? input.startDate,
      isActive: first !== null && input.isActive,
      createdAt: now,
      updatedAt: now,
    }

    await db.recurringTransactions.add(recurring)
    return recurring
  },

  /**
   * Меняет расписание и пересчитывает ближайшее вхождение.
   * Уже созданные операции не трогаются: пользователь мог их отредактировать.
   */
  async update(id: Id, input: RecurringInput, today: IsoDate): Promise<void> {
    await db.transaction('rw', db.recurringTransactions, async () => {
      const existing = await db.recurringTransactions.get(id)
      if (!existing) throw new Error('Регулярная операция не найдена')

      const from = input.startDate > today ? input.startDate : today
      const next = nextOccurrenceOnOrAfter(input, from)

      await db.recurringTransactions.put({
        ...input,
        id,
        nextOccurrence: next ?? existing.nextOccurrence,
        isActive: next !== null && input.isActive,
        lastGeneratedAt: existing.lastGeneratedAt,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      })
    })
  },

  async setActive(id: Id, isActive: boolean): Promise<void> {
    const updated = await db.recurringTransactions.update(id, { isActive, updatedAt: Date.now() })
    if (updated === 0) throw new Error('Регулярная операция не найдена')
  },

  /** Удаляет расписание. Уже созданные им операции остаются в истории. */
  remove(id: Id): Promise<void> {
    return db.recurringTransactions.delete(id)
  },

  /** Сколько операций уже создано этим расписанием. */
  async countGenerated(id: Id): Promise<number> {
    return (await generatedDatesOf(id)).size
  },

  /**
   * Создаёт операции по всем просроченным расписаниям.
   *
   * Идемпотентно по двум причинам: уже созданные вхождения отсеиваются
   * внутри той же транзакции, а составной индекс [recurringId+occurrenceDate]
   * уникален — даже гонка двух вкладок не создаст дубль.
   *
   * Пропущенные месяцы обрабатываются все: не открывал приложение с июля —
   * получишь июль, август и сентябрь.
   */
  async generateDue(today: IsoDate): Promise<GenerationResult> {
    return db.transaction('rw', db.recurringTransactions, db.transactions, async () => {
      const due = await db.recurringTransactions.where('nextOccurrence').belowOrEqual(today).toArray()

      let created = 0
      let rules = 0
      let finished = 0

      for (const rule of due) {
        // isActive не индексируем (IndexedDB не умеет булевы ключи) — проверяем здесь
        if (!rule.isActive) continue

        const dates = occurrencesBetween(rule, rule.nextOccurrence, today, MAX_OCCURRENCES_PER_RUN)
        const already = await generatedDatesOf(rule.id)
        const fresh = dates.filter((date) => !already.has(date))

        const now = Date.now()
        if (fresh.length > 0) {
          const rows: Transaction[] = fresh.map((date) => ({
            id: createId(),
            type: rule.type,
            amount: rule.amount,
            categoryId: rule.categoryId,
            accountId: rule.accountId,
            date,
            note: rule.note,
            recurringId: rule.id,
            occurrenceDate: date,
            createdAt: now,
            updatedAt: now,
          }))
          await db.transactions.bulkAdd(rows)
          created += rows.length
          rules += 1
        }

        // Следующее вхождение — строго после последнего обработанного
        const anchor = dates.at(-1) ?? today
        const next = nextOccurrenceOnOrAfter(rule, addDaysIso(anchor, 1))
        if (next === null) finished += 1

        await db.recurringTransactions.update(rule.id, {
          nextOccurrence: next ?? rule.nextOccurrence,
          isActive: next !== null,
          ...(fresh.length > 0 ? { lastGeneratedAt: now } : {}),
          updatedAt: now,
        })
      }

      return { created, rules, finished }
    })
  },
}
