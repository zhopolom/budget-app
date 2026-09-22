import Dexie from 'dexie'
import { db } from '../../db/database'
import type { Id, IsoDate, RecurringEntry, RecurringTransaction, RecurringTransfer, Transaction } from '../../types/entities'
import { addDaysIso } from '../../utils/dates'
import { createId } from '../../utils/id'
import { isSelfTransferRule } from './model'
import {
  MAX_BACKFILL_OCCURRENCES,
  MAX_OCCURRENCES_PER_RUN,
  nextOccurrenceOnOrAfter,
  occurrencesBetween,
  resumeOccurrence,
} from './occurrences'

/**
 * Данные регулярной операции без служебных полей: nextOccurrence считается сам.
 * Omit по объединению не распределяется сам, поэтому ветки перечислены явно —
 * иначе поля перевода и расхода слиплись бы в один тип.
 *
 * isActive сюда не входит намеренно: у флага активности единственный владелец —
 * setActive. Форма правки держит черновик, снятый при открытии шторки, и если бы
 * она писала isActive, то затирала бы кнопку «Отключить», нажатую минутой раньше.
 */
type Draft<T> = Omit<T, 'id' | 'nextOccurrence' | 'lastGeneratedAt' | 'isActive' | 'createdAt' | 'updatedAt'>
export type RecurringEntryInput = Draft<RecurringEntry>
export type RecurringTransferInput = Draft<RecurringTransfer>
export type RecurringInput = RecurringEntryInput | RecurringTransferInput

/** Что ждёт правило при возобновлении — на этом строится диалог. */
export interface ResumeInfo {
  /** Сколько платежей досоздаст backfill. Сегодняшний сюда не входит. */
  missed: number
  /** Сегодня день вхождения: этот платёж создастся в любом случае. */
  dueToday: boolean
  /** Расписание закончилось: возобновлять нечего, досоздать — можно. */
  finished: boolean
}

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

/**
 * Создаёт недостающие операции одного расписания и двигает nextOccurrence.
 * Вызывается и при обычном запуске, и при явном досоздании за паузу — разница
 * только в потолке: у запуска он держит открытие приложения быстрым.
 *
 * Вызывать только внутри транзакции над recurringTransactions и transactions.
 */
async function generateForRule(
  rule: RecurringTransaction,
  today: IsoDate,
  limit: number,
): Promise<{ created: number; finished: boolean }> {
  const dates = occurrencesBetween(rule, rule.nextOccurrence, today, limit)
  const already = await generatedDatesOf(rule.id)
  const fresh = dates.filter((date) => !already.has(date))

  const now = Date.now()
  if (fresh.length > 0) {
    await db.transactions.bulkAdd(fresh.map((date) => transactionFromRule(rule, date, now)))
  }

  // Следующее вхождение — строго после последнего обработанного
  const anchor = dates.at(-1) ?? today
  const next = nextOccurrenceOnOrAfter(rule, addDaysIso(anchor, 1))

  await db.recurringTransactions.update(rule.id, {
    nextOccurrence: next ?? rule.nextOccurrence,
    isActive: next !== null,
    ...(fresh.length > 0 ? { lastGeneratedAt: now } : {}),
    updatedAt: now,
  })

  return { created: fresh.length, finished: next === null }
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
      // Новое правило активно, если ему вообще есть когда сработать
      isActive: first !== null,
      createdAt: now,
      updatedAt: now,
    }

    await db.recurringTransactions.add(recurring)
    return recurring
  },

  /**
   * Меняет расписание и пересчитывает ближайшее вхождение.
   * Уже созданные операции не трогаются: пользователь мог их отредактировать.
   *
   * Флаг активности берётся из базы, а не из формы: пока шторка открыта,
   * его могла поменять кнопка «Отключить» — форма об этом не знает.
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
        isActive: next !== null && existing.isActive,
        lastGeneratedAt: existing.lastGeneratedAt,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      })
    })
  },

  /**
   * Выключает и включает расписание. Возвращает число созданных операций —
   * больше нуля только при явном досоздании.
   *
   * Пауза по умолчанию означает, что за это время платежей не было: при
   * включении ближайшее вхождение отсчитывается от сегодняшнего дня, а не от
   * того, что осталось в прошлом. Иначе первый же generateDue создал бы
   * платежи за всю паузу — ровно этот баг и чинится. Если платёж выпадает на
   * сегодня, он создастся: пауза кончилась, и он не пропущен, а наступил.
   *
   * С backfill: true платежи создаются здесь же, а не при следующем открытии
   * приложения: кнопка «Создать N» должна создавать N, а не обещать.
   *
   * Все пути включения идут сюда: прямой update(..., { isActive: true })
   * в коде запрещён, потому что он не трогает nextOccurrence.
   */
  async setActive(
    id: Id,
    isActive: boolean,
    today: IsoDate,
    options: { backfill?: boolean } = {},
  ): Promise<number> {
    return db.transaction('rw', db.recurringTransactions, db.transactions, async () => {
      const rule = await db.recurringTransactions.get(id)
      if (!rule) throw new Error('Регулярная операция не найдена')

      const now = Date.now()

      // Выключение nextOccurrence не трогает: вернёмся — пересчитаем
      if (!isActive) {
        await db.recurringTransactions.update(id, { isActive: false, updatedAt: now })
        return 0
      }

      // Перевод, у которого обе стороны свелись к одному счёту, включать некуда:
      // он создавал бы операции, не меняющие ничего, кроме оборотов счёта
      if (isSelfTransferRule(rule)) {
        throw new Error('Обе стороны перевода — один счёт: выберите другой счёт в форме')
      }

      if (options.backfill) {
        await db.recurringTransactions.update(id, { isActive: true, updatedAt: now })
        const refreshed = await db.recurringTransactions.get(id)
        if (!refreshed) return 0
        return (await generateForRule(refreshed, today, MAX_BACKFILL_OCCURRENCES)).created
      }

      const next = resumeOccurrence(rule, today)
      if (next === null) {
        throw new Error('Расписание уже закончилось — измените дату окончания')
      }

      await db.recurringTransactions.update(id, { isActive: true, nextOccurrence: next, updatedAt: now })
      return 0
    })
  },

  /**
   * Что произойдёт при возобновлении: сколько платежей досоздаст backfill,
   * создастся ли сегодняшний и не закончилось ли расписание вовсе.
   *
   * Правая граница пропущенного — вхождение, с которого правило продолжится,
   * и она не входит: сегодняшний платёж создастся в любом случае, и называть
   * его пропущенным значило бы обещать на единицу больше, чем будет создано.
   * Лимит одного прохода здесь не годится: число показывают пользователю.
   */
  async resumeInfo(id: Id, today: IsoDate): Promise<ResumeInfo> {
    const rule = await db.recurringTransactions.get(id)
    if (!rule) return { missed: 0, dueToday: false, finished: false }

    const resume = resumeOccurrence(rule, today)
    // Расписание закончилось — пропущено всё несозданное до конца расписания
    const until = resume ?? today

    const dates = occurrencesBetween(rule, rule.nextOccurrence, until, MAX_BACKFILL_OCCURRENCES)
    const already = await generatedDatesOf(id)
    const fresh = dates.filter((date) => !already.has(date))

    return {
      missed: resume === null ? fresh.length : fresh.filter((date) => date < resume).length,
      // Если сегодняшний платёж уже создан, обещать его было бы неправдой
      dueToday: resume === today && !already.has(today),
      finished: resume === null,
    }
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

        // Последняя защита: перевод сам на себя не создаёт ничего осмысленного.
        // Такое правило появляется только от объединения счетов и уже выключается
        // при удалении — но если флаг подняли в обход setActive, гасим его здесь
        if (isSelfTransferRule(rule)) {
          await db.recurringTransactions.update(rule.id, { isActive: false, updatedAt: Date.now() })
          continue
        }

        const result = await generateForRule(rule, today, MAX_OCCURRENCES_PER_RUN)
        if (result.created > 0) {
          created += result.created
          rules += 1
        }
        if (result.finished) finished += 1
      }

      return { created, rules, finished }
    })
  },
}
