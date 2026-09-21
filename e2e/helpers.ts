import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Приложение ждёт, пока откроется база и посеются счета по умолчанию.
 * Ждать появления баланса надёжнее, чем произвольную паузу.
 */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(balance(page)).toBeVisible()
}

export function balance(page: Page): Locator {
  return page.getByRole('region', { name: 'Баланс' })
}

/** Крупная сумма под подписью «Общий баланс». */
export function totalBalance(page: Page): Locator {
  return balance(page).locator('p').nth(1)
}

/** Плитка «Доходы» или «Расходы» за месяц. */
export function monthTile(page: Page, name: 'Доходы' | 'Расходы'): Locator {
  return balance(page).locator('div', { has: page.getByText(name, { exact: true }) }).locator('dd')
}

/** Суммы приходят с неразрывными пробелами и минусом U+2212 — сравнивать удобнее без них. */
export function digitsOf(text: string): string {
  return text.replace(/[  \s₴]/g, '').replace(/−/g, '-')
}

export async function expectAmount(locator: Locator, expected: string): Promise<void> {
  await expect(async () => {
    expect(digitsOf((await locator.innerText()).trim())).toBe(expected)
  }).toPass()
}

interface EntryOptions {
  type?: 'Расход' | 'Доход'
  amount: string
  category: string
  account?: string
  note?: string
}

/** Добавляет расход или доход тем же путём, которым идёт человек. */
export async function addEntry(page: Page, { type = 'Расход', amount, category, account, note }: EntryOptions) {
  await page.getByLabel('Добавить операцию').click()
  await expect(page.getByLabel('Сумма')).toBeVisible()

  if (type !== 'Расход') {
    await page.getByRole('radiogroup', { name: 'Тип операции' }).getByRole('radio', { name: type }).click()
  }
  await page.getByLabel('Сумма').fill(amount)
  await page.getByRole('radiogroup', { name: 'Категория' }).getByRole('radio', { name: category }).click()
  if (account) {
    await page.getByRole('radiogroup', { name: 'Счёт', exact: true }).getByRole('radio', { name: account }).click()
  }
  if (note) await page.getByLabel('Комментарий').fill(note)

  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(balance(page)).toBeVisible()
}

/** Перевод между счетами. */
export async function addTransfer(page: Page, amount: string, from: string, to: string) {
  await page.getByLabel('Добавить операцию').click()
  await page.getByRole('radiogroup', { name: 'Тип операции' }).getByRole('radio', { name: 'Перевод' }).click()
  await page.getByLabel('Сумма').fill(amount)
  await page.getByRole('radiogroup', { name: 'Счёт списания' }).getByRole('radio', { name: from }).click()
  await page.getByRole('radiogroup', { name: 'Счёт зачисления' }).getByRole('radio', { name: to }).click()

  await page.getByRole('button', { name: 'Перевести' }).click()
  await expect(balance(page)).toBeVisible()
}

/** Кнопка в диалоге подтверждения. */
export function confirmButton(page: Page, name: string): Locator {
  return page.getByRole('alertdialog').getByRole('button', { name })
}

export async function goToSettings(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Настройки' }).click()
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible()
}
