import Dexie from 'dexie'
import { db } from '../../db/database'
import type { Id, IsoDate, RecurringEntry, RecurringTransaction, RecurringTransfer, Transaction } from '../../types/entities'
import { addDaysIso } from '../../utils/dates'
import { createId } from '../../utils/id'
import { MAX_OCCURRENCES_PER_RUN, nextOccurrenceOnOrAfter, occurrencesBetween } from './occurrences'

/**
 * Данные регулярной операции без служебных полей: nextOccurrence считается сам.
 * Omit по объединению не распределяется сам, поэтому ветки перечислены явно —
 * иначе поля перевода и расхода слиплись бы в один тип.
 */
type Draft<T> = Omit<T, 'id' | 'nextOccurrence' | 'lastGeneratedAt' | 'createdAt' | 'updatedAt'>
export type RecurringEntryInput = Draft<RecurringEntry>
export type RecurringTransferInput = Draft<RecurringTransfer>
export type RecurringInput = RecurringEntryInput | RecurringTransferInput

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

/** Операция, созданная расписанием. Перевод получает оба счёта, расход — категорию. */
function transactionFromRule(rule: RecurringTransaction, date: IsoDate, now: number): Transaction {
  const base = {
    id: createId(),
    amount: rule.amount,
    date,
    note: rule.note,
    recurringId: rule.id,
    occurrenceDate: date,
    createdAt: now,
    updatedAt: now,
  }

  if (rule.type === 'transfer') {
    return { ...base, type: 'transfer', fromAccountId: rule.fromAccountId, toAccountId: rule.toAccountId }
  }
  return { ...base, type: rule.type, accountId: rule.accountId, categoryId: rule.categoryId }
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

  /**
   * Выключает и включает расписание.
   *
   * Пауза по умолчанию означает, что за это время платежей не было: при
   * включении ближайшее вхождение пересчитывается от сегодняшнего дня.
   * Иначе первый же generateDue создал бы платежи за всю паузу — ровно этот
   * баг и чинится. Досоздать пропущенное можно только явно, backfill: true.
   *
   * Все пути включения идут сюда: прямой update(..., { isActive: true })
   * в коде запрещён, потому что он не трогает nextOccurrence.
   */
  async setActive(id: Id, isActive: boolean, today: IsoDate, options: { backfill?: boolean } = {}): Promise<void> {
    await db.transaction('rw', db.recurringTransactions, async () => {
      const rule = await db.recurringTransactions.get(id)
      if (!rule) throw new Error('Регулярная операция не найдена')

      const now = Date.now()

      // Выключение nextOccurrence не трогает: вернёмся — пересчитаем
      if (!isActive) {
        await db.recurringTransactions.update(id, { isActive: false, updatedAt: now })
        return
      }

      if (options.backfill) {
        await db.recurringTransactions.update(id, { isActive: true, updatedAt: now })
        return
      }

      const from = rule.startDate > today ? rule.startDate : today
      const next = nextOccurrenceOnOrAfter(rule, from)
      if (next === null) {
        throw new Error('Расписание уже закончилось — измените дату окончания')
      }

      await db.recurringTransactions.update(id, { isActive: true, nextOccurrence: next, updatedAt: now })
    })
  },

  /**
   * Сколько вхождений накопилось в промежутке [nextOccurrence; today] и ещё не
   * создано. Столько платежей предложит досоздать диалог при возобновлении.
   */
  async countMissed(id: Id, today: IsoDate): Promise<number> {
    const rule = await db.recurringTransactions.get(id)
    if (!rule) return 0

    const dates = occurrencesBetween(rule, rule.nextOccurrence, today, MAX_OCCURRENCES_PER_RUN)
    const already = await generatedDatesOf(id)
    return dates.filter((date) => !already.has(date)).length
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
          const rows = fresh.map((date) => transactionFromRule(rule, date, now))
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
