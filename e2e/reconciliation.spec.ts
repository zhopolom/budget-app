import { expect, test } from '@playwright/test'
import { addEntry, expectAmount, monthTile, openApp, totalBalance } from './helpers'

/** Открывает страницу счёта через «Настройки → Счета». */
async function openAccount(page: Parameters<typeof openApp>[0], name: string) {
  await page.goto('/accounts')
  await expect(page.getByRole('heading', { name: 'Счета' })).toBeVisible()
  await page.getByRole('list', { name: 'Счета' }).getByText(name, { exact: true }).click()
  await expect(page.getByRole('region', { name: 'Остаток на счёте' })).toBeVisible()
}

test('сверка остатка создаёт корректировку, которая не попадает в расходы', async ({ page }) => {
  await openApp(page)
  await addEntry(page, { type: 'Доход', amount: '1000', category: 'Зарплата', account: 'Карта' })
  await expectAmount(totalBalance(page), '1000')

  await openAccount(page, 'Карта')
  await page.getByRole('button', { name: 'Сверить баланс' }).click()

  const sheet = page.getByRole('dialog', { name: 'Сверка остатка' })
  await expect(sheet).toBeVisible()
  // Пока сумма не введена, создавать нечего
  await expect(sheet.getByRole('button', { name: 'Создать корректировку' })).toBeDisabled()

  await sheet.getByLabel('Фактический баланс').fill('787')
  await expect(sheet.getByText('Будет создана корректировка −213 ₴.')).toBeVisible()
  await sheet.getByRole('button', { name: 'Создать корректировку' }).click()

  await expect(page.getByText('Создана корректировка −213 ₴')).toBeVisible()
  await expectAmount(page.getByRole('region', { name: 'Остаток на счёте' }).locator('p').nth(1), '787')
  await expect(page.getByText('Корректировка остатка')).toBeVisible()

  // Корректировка меняет остаток, но не расходы за месяц
  await page.goto('/')
  await expectAmount(totalBalance(page), '787')
  await expectAmount(monthTile(page, 'Расходы'), '0')
  await expectAmount(monthTile(page, 'Доходы'), '+1000')
})

test('при совпадении остатков корректировка не создаётся', async ({ page }) => {
  await openApp(page)
  await openAccount(page, 'Наличные')
  await page.getByRole('button', { name: 'Сверить баланс' }).click()

  const sheet = page.getByRole('dialog', { name: 'Сверка остатка' })
  await sheet.getByLabel('Фактический баланс').fill('0')
  await expect(sheet.getByText('Остатки совпадают — корректировка не нужна.')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Создать корректировку' })).toBeDisabled()
})
