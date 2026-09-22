import { expect, test, type Page } from '@playwright/test'
import { addEntry, digitsOf, expectAmount, goToSettings, openApp } from './helpers'

/** Ежедневный расход 100 ₴ с сегодняшнего дня — через ту же форму, что и у человека. */
async function createDailyRule(page: Page, note: string) {
  await goToSettings(page)
  await page.getByRole('button', { name: 'Регулярные операции' }).click()
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByLabel('Сумма').fill('100')
  await page.getByRole('radiogroup', { name: 'Категория' }).getByRole('radio', { name: 'Транспорт' }).click()
  await page.getByRole('radiogroup', { name: 'Как часто повторять' }).getByRole('radio', { name: 'День' }).click()
  await page.getByLabel('Комментарий').fill(note)
  await page.getByRole('button', { name: 'Создать' }).click()
  await expect(page.getByRole('button', { name: new RegExp(note) })).toBeVisible()
}

/** Значение строки «dt → dd» в карточке. */
function rowValue(page: Page, card: ReturnType<Page['getByRole']>, label: string) {
  return card.locator('div', { has: page.getByText(label, { exact: true }) }).locator('dd')
}

/** Часы берём из браузера: у него та же дата, что и у приложения. */
async function calendar(page: Page) {
  return page.evaluate(() => {
    const now = new Date()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    return { day: now.getDate(), daysInMonth }
  })
}

test('прогноз и ближайшие операции считаются по расписаниям, ориентир — по бюджету', async ({ page }) => {
  await openApp(page)
  await addEntry(page, { type: 'Доход', amount: '18420', category: 'Зарплата', account: 'Карта' })
  await addEntry(page, { amount: '3800', category: 'Продукты', account: 'Карта' })
  await createDailyRule(page, 'Проездной')

  await page.goto('/budgets')
  await page.getByRole('button', { name: 'Установить бюджет' }).click()
  await page.getByLabel('Лимит расходов на месяц').fill('10000')
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('button', { name: 'Изменить' })).toBeVisible()

  // Открытие главной создаёт сегодняшний платёж: он уходит в историю, а не в план
  await page.goto('/')
  const { day, daysInMonth } = await calendar(page)
  const daysRemaining = daysInMonth - day + 1
  const balance = 18_420 - 3_800 - 100

  const upcoming = page.getByRole('list', { name: 'Ближайшие операции' })
  await expect(upcoming.getByRole('button', { name: /Проездной/ }).first()).toContainText('Завтра · Карта')
  await expectAmount(upcoming.getByRole('button', { name: /Проездной/ }).first().locator('span').last(), '-100')

  // Ориентир: (10 000 − 3 800 − 100) / оставшиеся дни, вниз до целых
  const budget = page.getByRole('region', { name: /^Бюджет / })
  await expectAmount(rowValue(page, budget, 'Осталось бюджета'), '6100')
  await expect(rowValue(page, budget, 'До конца месяца')).toContainText(String(daysRemaining))
  await expect(rowValue(page, budget, 'Ориентир')).toContainText(`≈${Math.floor(6_100 / daysRemaining)}`)

  // Прогноз до конца месяца: по одному платежу на каждый оставшийся день после сегодняшнего
  const planned = daysRemaining - 1
  const forecast = page.getByRole('region', { name: /^Прогноз до конца/ })
  if (planned === 0) {
    // В последний день месяца ждать нечего — карточки нет
    await expect(forecast).toHaveCount(0)
    return
  }
  await expectAmount(rowValue(page, forecast, 'Сейчас'), String(balance))
  await expectAmount(rowValue(page, forecast, 'Запланированные расходы'), `-${planned * 100}`)
  await expectAmount(rowValue(page, forecast, 'Прогноз'), String(balance - planned * 100))
  await expect(forecast).toContainText('не гарантированный остаток')

  // Тап по строке ведёт к расписанию
  await upcoming.getByRole('button', { name: /Проездной/ }).first().click()
  await expect(page.getByRole('dialog', { name: 'Регулярная операция' })).toBeVisible()
  expect(digitsOf(await page.getByLabel('Сумма').inputValue())).toBe('100')
})

test('прогноз показывается только для текущего месяца', async ({ page }) => {
  await openApp(page)
  await createDailyRule(page, 'Проездной')
  await page.goto('/')
  await expect(page.getByRole('list', { name: 'Ближайшие операции' })).toBeVisible()

  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page.getByRole('list', { name: 'Ближайшие операции' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: /^Прогноз до конца/ })).toHaveCount(0)
})
