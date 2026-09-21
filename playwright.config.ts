import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const BASE_URL = `http://127.0.0.1:${PORT}`

/** Сборки с уже установленным Chromium (CI-образы) указывают путь сюда. */
const chromiumPath = process.env.CHROMIUM_PATH

/**
 * Сценарии гоняются по production-сборке, а не по dev-серверу: service worker,
 * разбиение на чанки и минификация — часть того, что может сломаться.
 *
 * Два браузера, оба в размере iPhone. webkit — это и есть Safari, в котором
 * приложение живёт на телефоне; chromium ловит то, что webkit пропускает, и
 * работает там, где webkit не установлен.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'webkit', use: { ...devices['iPhone 14'] } },
    {
      // Тот же размер экрана, но другой движок
      name: 'chromium',
      use: {
        ...devices['iPhone 14'],
        browserName: 'chromium',
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
