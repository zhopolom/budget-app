import { expect, test, type Page } from '@playwright/test'
import { expectAmount, goToSettings, openApp } from './helpers'

async function openBudgets(page: Page) {
  await goToSettings(page)
  await page.getByRole('button', { name: 'Бюджет и лимиты' }).click()
  await expect(page.getByRole('heading', { name: 'Бюджет' })).toBeVisible()
}

async function setTotal(page: Page, amount: string) {
  await page.getByRole('region', { name: 'Общий бюджет месяца' }).getByRole('button', { name: /Установить бюджет|Изменить/ }).click()
  await page.getByLabel('Лимит расходов на месяц').fill(amount)
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function setLimit(page: Page, category: string, amount: string, rollover?: boolean) {
  await page.getByRole('list', { name: 'Категории расходов' }).getByRole('button', { name: new RegExp(`^${category}`) }).click()
  await page.getByLabel(/^Лимит на /).fill(amount)
  if (rollover !== undefined) await page.getByRole('checkbox', { name: /Переносить остаток/ }).setChecked(rollover)
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

const limitRow = (page: Page, category: string) =>
  page.getByRole('list', { name: 'Категории расходов' }).getByRole('button', { name: new RegExp(`^${category}`) })

/** Расход с явной датой — через форму операции. */
async function addExpenseOn(page: Page, amount: string, category: string, date: string) {
  await page.goto('/add')
  await page.getByLabel('Сумма').fill(amount)
  await page.getByRole('radiogroup', { name: 'Категория' }).getByRole('radio', { name: category }).click()
  await page.getByLabel('Дата').fill(date)
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Баланс' })).toBeVisible()
}

/** Десятое число прошлого месяца — по часам браузера. */
async function previousMonthDate(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date()
    const date = new Date(now.getFullYear(), now.getMonth() - 1, 10)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-10`
  })
}

test('шаблон сохраняется из месяца и применяется к пустому месяцу сразу, к занятому — через превью', async ({ page }) => {
  await openApp(page)
  await openBudgets(page)
  await setTotal(page, '10000')
  await setLimit(page, 'Продукты', '5000')

  await page.getByRole('button', { name: 'Сохранить как шаблон' }).click()
  await page.getByLabel('Название шаблона').fill('Обычный месяц')
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Шаблон «Обычный месяц» сохранён')).toBeVisible()

  // Следующий месяц пуст: шаблон применяется без вопросов
  await page.getByRole('button', { name: 'Следующий месяц' }).click()
  await expect(page.getByRole('region', { name: 'Общий бюджет месяца' })).toContainText('Не задан')
  await page.getByRole('list', { name: 'Шаблоны бюджета' }).getByRole('button', { name: /Обычный месяц/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Применить к/ }).click()
  await expect(page.getByRole('region', { name: 'Общий бюджет месяца' })).toContainText('10 000 ₴')
  await expect(limitRow(page, 'Продукты')).toContainText('5 000 ₴')

  // Месяц занят: применение показывает превью, «Заменить» возвращает 5 000
  await setLimit(page, 'Продукты', '7000')
  await page.getByRole('list', { name: 'Шаблоны бюджета' }).getByRole('button', { name: /Обычный месяц/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Применить к/ }).click()
  const preview = page.getByRole('dialog', { name: /^Применить к/ })
  await expect(preview).toContainText('бюджет уже задан')
  await expect(preview).toContainText(/изменит 1 лимит/i)
  await preview.getByRole('button', { name: 'Заменить' }).click()
  await expect(limitRow(page, 'Продукты')).toContainText('5 000 ₴')
})

test('копирование бюджета прошлого месяца создаёт общий бюджет и лимиты', async ({ page }) => {
  await openApp(page)
  await openBudgets(page)
  await setTotal(page, '12000')
  await setLimit(page, 'Транспорт', '2000')

  await page.getByRole('button', { name: 'Следующий месяц' }).click()
  await page.getByRole('button', { name: /^Скопировать бюджет за/ }).click()

  await expect(page.getByRole('region', { name: 'Общий бюджет месяца' })).toContainText('12 000 ₴')
  await expect(limitRow(page, 'Транспорт')).toContainText('2 000 ₴')
})

test('перенос остатка: неизрасходованные 800 ₴ прошлого месяца добавляются к лимиту', async ({ page }) => {
  await openApp(page)
  const lastMonth = await previousMonthDate(page)
  await addExpenseOn(page, '5200', 'Продукты', lastMonth)

  await openBudgets(page)
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await setLimit(page, 'Продукты', '6000', true)
  await expect(limitRow(page, 'Продукты')).toContainText('с переносом остатка')

  await page.getByRole('button', { name: 'Следующий месяц' }).click()
  await setLimit(page, 'Продукты', '6000')
  await expect(limitRow(page, 'Продукты')).toContainText('6 000 ₴ + 800 ₴ перенос')
  await expect(limitRow(page, 'Продукты')).toContainText('6 800 ₴')

  // На главной перенос виден отдельно, а не растворён в лимите
  await page.goto('/')
  const categories = page.getByRole('region', { name: 'Категории' })
  await expect(categories).toContainText('+ 800 ₴ перенос с прошлого месяца')
  await expectAmount(categories.locator('p').filter({ hasText: '/ 6 800' }).first(), '0/6800')
})
