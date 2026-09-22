import { defineConfig } from 'vitest/config'

/** Отдельный конфиг для замера скорости: npm run bench. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/dev/benchmark.perf.ts'],
    setupFiles: ['./src/test/setup.ts'],
    // Один процесс: замеры не должны конкурировать за CPU
    pool: 'forks',
    maxWorkers: 1,
  },
})
