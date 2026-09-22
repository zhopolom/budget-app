import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { resetTestDatabase } from '../../test/db'
import { DEFAULT_ACCOUNT_IDS } from '../accounts/defaults'
import { SYSTEM_CATEGORY_IDS as C } from '../categories/defaults'
import { calculateTotalBalance } from '../transactions/calculations'
import { transactionsRepository } from '../transactions/repository'
import type { ColumnMapping } from './mapping'
import { importRepository, loadExistingFingerprints } from './repository'
import { assignCategory, buildImportRows } from './session'

const { card } = DEFAULT_ACCOUNT_IDS

const MAPPING: ColumnMapping = {
  date: 0,
  description: 1,
  amountMode: 'signed',
  amount: 2,
  debit: null,
  credit: null,
  type: null,
  category: null,
  dateFormat: 'DD.MM.YYYY',
  invertSign: false,
}

const FILE = [
  ['21.09.2026', 'АТБ', '-430,00'],
  ['22.09.2026', 'Зарплата', '32 000'],
  ['23.09.2026', 'Сільпо', '-120,50'],
]

async function rowsOf(records: string[][]) {
  const categories = await db.categories.toArray()
  const existing = await loadExistingFingerprints(card)
  return buildImportRows(records, { accountId: card, mapping: MAPPING, rules: [], categories, existingFingerprints: existing }).map(
    (row) => (row.type === 'income' ? assignCategory(row, C.salary) : assignCategory(row, C.groceries)),
  )
}

const balance = async () => calculateTotalBalance(await db.accounts.toArray(), await db.transactions.toArray())

beforeEach(resetTestDatabase)

describe('importRepository.commit', () => {
  it('записывает включённые строки с метаданными и историю одной партией', async () => {
    const rows = await rowsOf(FILE)
    const history = await importRepository.commit({ fileName: 'bank.csv', accountId: card, rows })

    expect(history).toMatchObject({ fileName: 'bank.csv', accountId: card, count: 3, skippedCount: 0, duplicateCount: 0, errorCount: 0 })
    const imported = await db.transactions.where('importBatchId').equals(history.id).sortBy('date')
    expect(imported).toHaveLength(3)
    expect(imported[0]).toMatchObject({ type: 'expense', amount: 43_000, note: 'АТБ', source: 'csv', categoryId: C.groceries })
    expect(imported[0].sourceFingerprint).toBe(rows[0].fingerprint)
    expect(await balance()).toBe(3_200_000 - 43_000 - 12_050)
  })

  it('исключённые строки не пишутся и считаются пропущенными', async () => {
    const rows = await rowsOf(FILE)
    rows[1] = { ...rows[1], include: false }
    const history = await importRepository.commit({ fileName: 'bank.csv', accountId: card, rows })
    expect(history).toMatchObject({ count: 2, skippedCount: 1 })
    expect(await db.transactions.count()).toBe(2)
  })

  it('повторный импорт того же файла помечает всё дублями — по сохранённым отпечаткам', async () => {
    await importRepository.commit({ fileName: 'bank.csv', accountId: card, rows: await rowsOf(FILE) })
    const again = await rowsOf(FILE)
    expect(again.every((row) => row.status === 'duplicate' && row.duplicateOf === 'existing' && !row.include)).toBe(true)
    await expect(importRepository.commit({ fileName: 'bank.csv', accountId: card, rows: again })).rejects.toThrow('Нет строк')
    expect(await db.transactions.count()).toBe(3)
  })

  it('операция, введённая вручную, тоже считается существующей — отпечаток считается по полям', async () => {
    await transactionsRepository.create({ type: 'expense', amount: 43_000, categoryId: C.groceries, accountId: card, date: '2026-09-21', note: 'АТБ' })
    const rows = await rowsOf(FILE)
    expect(rows[0].status).toBe('duplicate')
    expect(rows[1].status).toBe('ready')
  })

  it('битая категория откатывает всю партию', async () => {
    const rows = await rowsOf(FILE)
    rows[2] = { ...rows[2], categoryId: 'cat-ghost' }
    await expect(importRepository.commit({ fileName: 'bank.csv', accountId: card, rows })).rejects.toThrow('категория не найдена')
    expect(await db.transactions.count()).toBe(0)
    expect(await db.importHistory.count()).toBe(0)
  })
})

describe('importRepository.rollback', () => {
  it('удаляет только свою партию и помечает историю', async () => {
    await transactionsRepository.create({ type: 'expense', amount: 100, categoryId: C.groceries, accountId: card, date: '2026-09-01', note: 'вручную' })
    const first = await importRepository.commit({ fileName: 'a.csv', accountId: card, rows: await rowsOf(FILE) })
    const second = await importRepository.commit({ fileName: 'b.csv', accountId: card, rows: await rowsOf([['25.09.2026', 'Кафе', '-80']]) })
    const before = await balance()

    expect(await importRepository.rollbackPreview(first.id)).toEqual({ total: 3, modified: 0, alreadyRolledBack: false })
    const result = await importRepository.rollback(first.id, { includeModified: false })

    expect(result).toEqual({ deleted: 3, kept: 0 })
    expect(await db.transactions.count()).toBe(2)
    expect(await db.transactions.where('importBatchId').equals(second.id).count()).toBe(1)
    expect(await balance()).toBe(before + 43_000 - 3_200_000 + 12_050)
    expect((await importRepository.getHistory(first.id))?.rolledBackAt).toBeDefined()
    expect((await importRepository.rollbackPreview(first.id)).alreadyRolledBack).toBe(true)
  })

  it('изменённые после импорта записи не удаляются без явного согласия', async () => {
    const history = await importRepository.commit({ fileName: 'a.csv', accountId: card, rows: await rowsOf(FILE) })
    const [edited] = await db.transactions.where('importBatchId').equals(history.id).sortBy('date')
    // Правка через репозиторий сохраняет партию и двигает updatedAt
    await new Promise((resolve) => setTimeout(resolve, 2))
    await transactionsRepository.update(edited.id, { type: 'expense', amount: 45_000, categoryId: C.groceries, accountId: card, date: edited.date, note: 'АТБ (исправлено)' })
    expect((await db.transactions.get(edited.id))?.importBatchId).toBe(history.id)

    expect(await importRepository.rollbackPreview(history.id)).toMatchObject({ total: 3, modified: 1 })

    const gentle = await importRepository.rollback(history.id, { includeModified: false })
    expect(gentle).toEqual({ deleted: 2, kept: 1 })
    expect(await db.transactions.get(edited.id)).toBeDefined()

    const full = await importRepository.rollback(history.id, { includeModified: true })
    expect(full).toEqual({ deleted: 1, kept: 0 })
    expect(await db.transactions.count()).toBe(0)
  })
})
