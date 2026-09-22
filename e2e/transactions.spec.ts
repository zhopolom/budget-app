import { expect, test } from '@playwright/test'
import { addEntry, expectAmount, openApp, totalBalance } from './helpers'

test('операцию можно изменить и удалить, баланс следует за ней', async ({ page }) => {
  await openApp(page)
  await addEntry(page, { amount: '430', category: 'Продукты', note: 'АТБ' })
  await expectAmount(totalBalance(page), '-430')

  // Правка: тап по строке открывает форму с текущими значениями
  await page.getByRole('button', { name: /Продукты.*АТБ/ }).click()
  await expect(page.getByRole('heading', { name: 'Операция' })).toBeVisible()
  await page.getByLabel('Сумма').fill('450')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Операция изменена')).toBeVisible()
  await expectAmount(totalBalance(page), '-450')

  // Удаление — только через подтверждение
  await page.getByRole('button', { name: /Продукты.*АТБ/ }).click()
  await page.getByRole('button', { name: 'Удалить операцию' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Продукты, −450 ₴')
  await dialog.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByText('Операция удалена')).toBeVisible()
  await expectAmount(totalBalance(page), '0')
  await expect(page.getByText('АТБ')).toHaveCount(0)
})
