import { afterAll, beforeAll, it } from 'vitest'
import { db } from '../db/database'
import { formatBenchmark, runBenchmark, type BenchmarkResult } from './benchmark'

/**
 * Не тест, а замер: запускается отдельно (npm run bench) и печатает таблицу.
 * В обычный прогон не входит — на 50 000 операций он занимает минуты.
 */

const SIZES = [1_000, 10_000, 25_000, 50_000]

beforeAll(async () => {
  db.close()
  await db.delete()
  await db.open()
})

afterAll(() => db.close())

it('замер расчётов на большой истории', async () => {
  const results: BenchmarkResult[] = []
  for (const size of SIZES) {
    results.push(await runBenchmark(size))
    // Промежуточный вывод: на больших размерах ждать конца долго
    console.log(`\n${formatBenchmark(results)}\n`)
  }
}, 30 * 60 * 1_000)
