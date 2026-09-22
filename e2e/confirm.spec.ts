import { expect, test, type Page } from '@playwright/test'
import { digitsOf, expectAmount, goToSettings, openApp, totalBalance } from './helpers'

/** Ежедневный расход 100 ₴ в режиме подтверждения — через ту же форму, что и у человека. */
async function createConfirmRule(page: Page, note: string) {
  await goToSettings(page)
  await page.getByRole('button', { name: 'Регулярные операции' }).click()
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByLabel('Сумма').fill('100')
  await page.getByRole('radiogroup', { name: 'Категория' }).getByRole('radio', { name: 'Транспорт' }).click()
  await page.getByRole('radiogroup', { name: 'Как часто повторять' }).getByRole('radio', { name: 'День' }).click()
  await page.getByRole('radiogroup', { name: 'Как создавать операцию' }).getByRole('radio', { name: 'Спрашивать' }).click()
  await page.getByLabel('Комментарий').fill(note)
  await page.getByRole('button', { name: 'Создать' }).click()
  await expect(page.getByRole('button', { name: new RegExp(`${note}.*с подтверждением`) })).toBeVisible()
}

const pendingCard = (page: Page) => page.getByRole('region', { name: 'Ожидают подтверждения' })
/** Поле суммы: по роли, чтобы подсказки с тем же словом в подписи не мешали. */
const amountField = (page: Page) => page.getByRole('textbox', { name: 'Сумма' })

/** Сколько операций с таким комментарием в списке операций. */
async function expectTransactions(page: Page, note: string, count: number) {
  await page.goto('/transactions')
  await expect(page.getByRole('heading', { name: 'Операции' })).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(`(^|\\s)${note}(\\s|$)`) })).toHaveCount(count)
}

test('подтверждение записывает операцию один раз, остаток до этого не меняется', async ({ page }) => {
  await openApp(page)
  await createConfirmRule(page, 'Проездной')

  // Открытие главной срабатывает расписанием: вместо операции — ожидающее вхождение
  await page.goto('/')
  await expect(pendingCard(page)).toContainText('Проездной')
  await expect(pendingCard(page)).toContainText('Сегодня · Карта')
  await expectAmount(totalBalance(page), '0')

  await pendingCard(page).getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.getByText('Операция записана')).toBeVisible()
  await expectAmount(totalBalance(page), '-100')
  await expect(pendingCard(page)).toHaveCount(0)

  // Перезапуск ничего не задваивает: день уже разобран
  await page.reload()
  await expectAmount(totalBalance(page), '-100')
  await expect(pendingCard(page)).toHaveCount(0)
  await expectTransactions(page, 'Проездной', 1)
})

test('пропуск ничего не записывает и не возвращается после перезапуска', async ({ page }) => {
  await openApp(page)
  await createConfirmRule(page, 'Проездной')
  await page.goto('/')
  await expect(pendingCard(page)).toContainText('Проездной')

  await pendingCard(page).getByRole('button', { name: 'Пропустить' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Проездной, −100 ₴ за сегодня не запишется')
  await dialog.getByRole('button', { name: 'Пропустить' }).click()

  await expect(page.getByText('Операция пропущена')).toBeVisible()
  await expect(pendingCard(page)).toHaveCount(0)
  await expectAmount(totalBalance(page), '0')

  await page.reload()
  await expect(pendingCard(page)).toHaveCount(0)
  await expectTransactions(page, 'Проездной', 0)
})

test('изменённое вхождение записывается с новой суммой, а расписание остаётся прежним', async ({ page }) => {
  await openApp(page)
  await createConfirmRule(page, 'Проездной')
  await page.goto('/')
  await expect(pendingCard(page)).toContainText('Проездной')

  await pendingCard(page).getByRole('button', { name: 'Изменить' }).click()
  await expect(page.getByRole('heading', { name: 'Подтверждение' })).toBeVisible()
  // Тип задан расписанием — переключателя нет
  await expect(page.getByRole('radiogroup', { name: 'Тип операции' })).toHaveCount(0)
  expect(digitsOf(await amountField(page).inputValue())).toBe('100')

  await amountField(page).fill('150')
  await page.getByRole('button', { name: 'Подтвердить' }).click()

  await expect(page.getByText('Операция записана')).toBeVisible()
  await expectAmount(totalBalance(page), '-150')
  await expect(pendingCard(page)).toHaveCount(0)

  // Расписание не тронуто: в форме правила по-прежнему 100
  await goToSettings(page)
  await page.getByRole('button', { name: 'Регулярные операции' }).click()
  await page.getByRole('button', { name: /Проездной/ }).click()
  expect(digitsOf(await amountField(page).inputValue())).toBe('100')
})

test('«изменить и все будущие» переписывает расписание', async ({ page }) => {
  await openApp(page)
  await createConfirmRule(page, 'Проездной')
  await page.goto('/')
  await pendingCard(page).getByRole('button', { name: 'Изменить' }).click()

  await amountField(page).fill('120')
  await page.getByRole('checkbox', { name: /Изменить и все будущие/ }).check()
  await page.getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.getByText('расписание обновлено')).toBeVisible()
  await expectAmount(totalBalance(page), '-120')

  await goToSettings(page)
  await page.getByRole('button', { name: 'Регулярные операции' }).click()
  await page.getByRole('button', { name: /Проездной/ }).click()
  expect(digitsOf(await amountField(page).inputValue())).toBe('120')
})
