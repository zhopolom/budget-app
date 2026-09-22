import { expect, test, type Page } from '@playwright/test'
import { addTransfer, digitsOf, expectAmount, goToSettings, openApp } from './helpers'

/** Накопительный счёт — через форму счёта, как это делает человек. */
async function createSavingsAccount(page: Page, name: string) {
  await goToSettings(page)
  await page.getByRole('button', { name: 'Счета' }).click()
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await page.getByLabel('Название').fill(name)
  await page.getByRole('radiogroup', { name: 'Тип счёта' }).getByRole('radio', { name: 'Накопления' }).click()
  await page.getByRole('button', { name: 'Создать счёт' }).click()
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
}

async function openGoals(page: Page) {
  await goToSettings(page)
  await page.getByRole('button', { name: 'Цели накоплений' }).click()
  await expect(page.getByRole('heading', { name: 'Цели' })).toBeVisible()
}

test('цель со счётом растёт от перевода, а не от расхода', async ({ page }) => {
  await openApp(page)
  await createSavingsAccount(page, 'Копилка')

  await openGoals(page)
  await page.getByRole('button', { name: 'Добавить цель' }).click()
  await page.getByLabel('Название').fill('MacBook')
  await page.getByLabel('Сумма цели').fill('80000')
  await page.getByRole('radiogroup', { name: 'Накопительный счёт' }).getByRole('radio', { name: 'Копилка' }).click()
  await page.getByRole('button', { name: 'Создать цель' }).click()

  const goal = page.getByRole('list', { name: 'Цели' }).getByRole('button', { name: /MacBook/ })
  await expect(goal).toContainText('0%')
  await expect(goal).toContainText('Счёт: Копилка')

  // Пополнение цели — обычный перевод: расходов не появляется, общий баланс тот же
  await page.goto('/')
  await addTransfer(page, '42000', 'Карта', 'Копилка')
  await expectAmount(page.getByRole('region', { name: 'Баланс' }).locator('div', { has: page.getByText('Расходы', { exact: true }) }).locator('dd'), '0')

  await openGoals(page)
  await expect(goal).toContainText('52%')
  expect(digitsOf((await goal.locator('span').filter({ hasText: '/ 80 000' }).first().innerText()).trim())).toContain('42000')
  await expect(goal).toContainText('Осталось 38 000 ₴')
})

test('цель без счёта считает накопленное вручную, архив и удаление не трогают операции', async ({ page }) => {
  await openApp(page)
  await openGoals(page)

  await page.getByRole('button', { name: 'Добавить цель' }).click()
  await page.getByLabel('Название').fill('Отпуск')
  await page.getByLabel('Сумма цели').fill('30000')
  await page.getByLabel('Уже накоплено').fill('7500')
  await page.getByRole('button', { name: 'Создать цель' }).click()

  const goal = page.getByRole('list', { name: 'Цели' }).getByRole('button', { name: /Отпуск/ })
  await expect(goal).toContainText('25%')
  await expect(goal).toContainText('Без счёта')

  await goal.click()
  await page.getByRole('button', { name: 'В архив' }).click()
  await expect(page.getByRole('region', { name: 'Архив целей' })).toContainText('Отпуск')
  await expect(page.getByRole('list', { name: 'Цели' })).toHaveCount(0)

  await page.getByRole('region', { name: 'Архив целей' }).getByRole('button', { name: /Отпуск/ }).click()
  await page.getByRole('button', { name: 'Удалить цель' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByText('Целей пока нет')).toBeVisible()
})
