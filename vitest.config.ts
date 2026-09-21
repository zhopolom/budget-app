import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // IndexedDB в памяти — тесты работают с настоящей схемой Dexie
    setupFiles: ['./src/test/setup.ts'],
  },
})
