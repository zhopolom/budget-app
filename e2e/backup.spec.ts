import { expect, test } from '@playwright/test'
import { addEntry, confirmButton, expectAmount, goToSettings, openApp, totalBalance } from './helpers'

test('копия сохраняется и восстанавливает данные после полного сброса', async ({ page }) => {
  await openApp(page)
  await addEntry(page, { amount: '430', category: 'Продукты', note: 'АТБ' })

  await goToSettings(page)
  await expect(page.getByText('Ещё не сохраняли')).toBeVisible()

  // navigator.share в тестовом браузере нет — копия уходит обычным скачиванием
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Сохранить копию' }).click(),
  ]).then(([event]) => event)

  expect(download.suggestedFilename()).toMatch(/^budget-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const file = await download.path()
  expect(file).not.toBeNull()
  await expect(page.getByText('Сегодня')).toBeVisible()

  // Стираем всё: после сброса приложение перезагружается само и остаётся в настройках
  await page.getByRole('button', { name: 'Удалить все данные' }).click()
  await confirmButton(page, 'Удалить всё').click()
  await expect(page.getByText('Ещё не сохраняли')).toBeVisible()

  await page.getByRole('button', { name: 'Восстановить из копии' }).click()
  await page.locator('input[type=file]').setInputFiles(file!)

  await expect(page.getByRole('alertdialog')).toContainText('1 операция')
  await confirmButton(page, 'Восстановить').click()

  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Главная' }).click()
  await expectAmount(totalBalance(page), '-430')
  await expect(page.getByText('АТБ')).toBeVisible()
})

test('диагностика открывается семью нажатиями по версии', async ({ page }) => {
  await openApp(page)
  await goToSettings(page)

  const version = page.getByRole('button', { name: /^Budget / })
  await expect(page.getByRole('region', { name: 'Диагностика' })).toHaveCount(0)

  for (let tap = 0; tap < 7; tap += 1) await version.click()

  const panel = page.getByRole('region', { name: 'Диагностика' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Кадров в секунду')).toBeVisible()
  await expect(panel.getByText('Service Worker')).toBeVisible()

  // Ступень размытия применяется к <html> — её видно и в стилях
  await panel.getByRole('radiogroup', { name: 'Ступень размытия' }).getByRole('radio', { name: 'Без' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-glass-blur', 'off')

  await panel.getByRole('button', { name: 'Скрыть диагностику' }).click()
  await expect(page.getByRole('region', { name: 'Диагностика' })).toHaveCount(0)
})
