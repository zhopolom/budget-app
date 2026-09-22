import { expect, test, type Page } from '@playwright/test'
import { expectAmount, goToSettings, openApp, totalBalance } from './helpers'

const CSV = [
  'Дата;Описание;Сумма',
  '21.09.2026;АТБ Маркет;-430,00',
  '22.09.2026;Зарплата за сентябрь;32 000,00',
  '23.09.2026;SPOTIFY Premium;-199,00',
  '21.09.2026;АТБ Маркет;-430,00',
].join('\r\n')

async function openImport(page: Page) {
  await goToSettings(page)
  await page.getByRole('button', { name: 'Импорт из CSV' }).click()
  await expect(page.getByRole('heading', { name: 'Импорт из CSV' })).toBeVisible()
}

async function uploadCsv(page: Page, content = CSV) {
  await page.locator('[data-testid="csv-file"]').setInputFiles({ name: 'bank.csv', mimeType: 'text/csv', buffer: Buffer.from(content, 'utf-8') })
}

const previewRow = (page: Page, text: string) => page.getByRole('list', { name: 'Строки файла' }).getByRole('button', { name: new RegExp(text) })

test('импорт CSV: колонки узнаются, дубль помечается, правило запоминается, операции записываются один раз', async ({ page }) => {
  await openApp(page)
  await openImport(page)
  await uploadCsv(page)

  // Сопоставление угадано по заголовкам и содержимому
  await expect(page.getByText(/4 строки, разделитель — точка с запятой, кодировка utf-8/)).toBeVisible()
  await expect(page.getByRole('radio', { name: '21.09.2026' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Показать превью' }).click()

  // Правил нет: категорию просят у пользователя; четвёртая строка — дубль третьей... то есть первой
  await expect(page.getByText(/Без категории: 3/)).toBeVisible()
  await expect(page.getByText(/Дубли: 1/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Импортировать 0 операций/ })).toBeDisabled()

  // Все расходы без категории — в «Продукты», доход — в «Зарплату»
  await page.getByRole('button', { name: /Категория для 2 расходов без категории/ }).click()
  await page.getByRole('dialog').getByRole('radio', { name: 'Продукты' }).click()
  await page.getByRole('button', { name: /Категория для 1 дохода без категории/ }).click()
  await page.getByRole('dialog').getByRole('radio', { name: 'Зарплата' }).click()
  await expect(page.getByRole('button', { name: /Импортировать 3 операции/ })).toBeEnabled()

  // Spotify — в «Подписки» вручную, и приложение предлагает запомнить правило (без ИИ)
  await previewRow(page, 'SPOTIFY Premium').click()
  await page.getByRole('dialog', { name: /^Строка/ }).getByRole('radio', { name: 'Подписки' }).click()
  const prompt = page.getByRole('dialog', { name: 'Запомнить правило?' })
  await expect(prompt).toContainText('Всегда относить операции с «SPOTIFY Premium» к «Подписки»?')
  await prompt.getByLabel('Текст').fill('spotify')
  await prompt.getByRole('button', { name: 'Создать правило' }).click()
  await expect(page.getByText('Правило создано и применено')).toBeVisible()

  await page.getByRole('button', { name: /Импортировать 3 операции/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Импортировать' }).click()
  await expect(page.getByRole('heading', { name: 'Импортировано 3 операции' })).toBeVisible()

  await page.getByRole('button', { name: 'К операциям' }).click()
  await expect(page.getByRole('heading', { name: 'Операции' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Подписки.*SPOTIFY Premium/ })).toBeVisible()
  await page.goto('/')
  await expectAmount(totalBalance(page), '31371')

  // Правило появилось в списке правил вместе с превью совпадений
  await goToSettings(page)
  await page.getByRole('button', { name: 'Правила категорий' }).click()
  await expect(page.getByRole('button', { name: /содержит «spotify» → Подписки/ })).toBeVisible()

  // Тот же файл ещё раз: всё дубли, правило подставило бы категорию, но импортировать нечего
  await openImport(page)
  await uploadCsv(page)
  await page.getByRole('button', { name: 'Показать превью' }).click()
  await expect(page.getByText(/Дубли: 4/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Импортировать 0 операций/ })).toBeDisabled()
})

test('откат импорта удаляет только его операции', async ({ page }) => {
  await openApp(page)
  await page.getByLabel('Добавить операцию').click()
  await page.getByLabel('Сумма').fill('50')
  await page.getByRole('radiogroup', { name: 'Категория' }).getByRole('radio', { name: 'Кафе' }).click()
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expectAmount(totalBalance(page), '-50')

  await openImport(page)
  await uploadCsv(page, ['Date,Amount,Description', '2026-09-21,-430,ATB', '2026-09-22,32000,Salary'].join('\n'))
  await page.getByRole('button', { name: 'Показать превью' }).click()
  await page.getByRole('button', { name: /Категория для 1 расхода без категории/ }).click()
  await page.getByRole('dialog').getByRole('radio', { name: 'Продукты' }).click()
  await page.getByRole('button', { name: /Категория для 1 дохода без категории/ }).click()
  await page.getByRole('dialog').getByRole('radio', { name: 'Зарплата' }).click()
  await page.getByRole('button', { name: /Импортировать 2 операции/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Импортировать' }).click()
  await expect(page.getByRole('heading', { name: 'Импортировано 2 операции' })).toBeVisible()

  await page.goto('/')
  await expectAmount(totalBalance(page), '31520')

  await goToSettings(page)
  await page.getByRole('button', { name: /bank\.csv/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отменить импорт' }).click()
  await expect(page.getByText(/Импорт отменён: удалено 2/)).toBeVisible()
  await expect(page.getByRole('list', { name: 'Импорт' })).toContainText('отменён')

  await page.goto('/')
  await expectAmount(totalBalance(page), '-50')
})
