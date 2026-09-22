import { expect, test, type Page } from '@playwright/test'
import { confirmButton, goToSettings, openApp } from './helpers'

/** Регулярный расход 199 на выбранном счёте — через ту же форму, что и у человека. */
async function createRule(page: Page, account: string, note: string) {
  await goToSettings(page)
  await page.getByRole('button', { name: 'Регулярные операции' }).click()
  await expect(page.getByRole('heading', { name: 'Регулярные операции' })).toBeVisible()

  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByLabel('Сумма').fill('199')
  await page.getByRole('radiogroup', { name: 'Категория' }).getByRole('radio', { name: 'Подписки' }).click()
  await page.getByRole('radiogroup', { name: 'Счёт', exact: true }).getByRole('radio', { name: account }).click()
  await page.getByLabel('Комментарий').fill(note)
  await page.getByRole('button', { name: 'Создать' }).click()

  await expect(page.getByRole('button', { name: new RegExp(note) })).toBeVisible()
}

test('счёт с регулярным платежом удаляется только вместе с переносом', async ({ page }) => {
  await openApp(page)
  await createRule(page, 'Наличные', 'Spotify')

  await goToSettings(page)
  await page.getByRole('button', { name: 'Счета' }).click()
  await page.getByRole('button', { name: /Наличные/ }).click()
  await page.getByRole('button', { name: 'Изменить' }).click()
  await page.getByRole('button', { name: 'Удалить счёт' }).click()

  // Баг v0.2: счёт удалялся молча, а правило оставалось с битой ссылкой
  await expect(page.getByText(/регулярный платёж/)).toBeVisible()

  await page.getByRole('radiogroup', { name: 'Счёт для переноса операций' }).getByRole('radio', { name: /Карта/ }).click()
  await page.getByRole('button', { name: 'Перенести и удалить счёт' }).click()

  await expect(page.getByRole('heading', { name: 'Счета' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Наличные/ })).toHaveCount(0)

  // Правило на месте и теперь ссылается на «Карту»
  await goToSettings(page)
  await page.getByRole('button', { name: 'Регулярные операции' }).click()
  await page.getByRole('button', { name: /Spotify/ }).click()
  await expect(page.getByRole('radiogroup', { name: 'Счёт', exact: true }).getByRole('radio', { name: /Карта/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})

/**
 * Сам баг v0.2 (включение досоздавало платежи за всю паузу) в браузере не
 * воспроизвести: для него нужна пауза длиной в месяцы, а часы в e2e не
 * перевести. Это проверяют юнит-тесты в features/recurring/bugs.test.ts.
 *
 * Здесь проверяется то, что видно только в живом интерфейсе: пауза держится
 * после сохранения формы, а переключение туда-обратно не плодит операций.
 */
test('пауза держится, а переключение не плодит операций', async ({ page }) => {
  await openApp(page)
  await createRule(page, 'Карта', 'Аренда')

  // Операции по расписанию создаются при открытии приложения
  await page.reload()
  await expect(page.getByRole('button', { name: /Аренда/ })).toBeVisible()
  await expectTransactions(page, 'Аренда', 1)

  await page.getByRole('button', { name: /Аренда/ }).click()
  await page.getByRole('button', { name: 'Отключить' }).click()
  await expect(page.getByText('Отключена', { exact: true })).toBeVisible()

  // Кнопка и форма живут в одной шторке: сохранение не должно возвращать
  // правило в строй — иначе платёж, от которого отказались, придёт снова
  await page.getByLabel('Сумма').fill('1500')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  await page.reload()
  await expect(page.getByRole('button', { name: /Аренда.*отключена/ })).toBeVisible()
  await expectTransactions(page, 'Аренда', 1)

  await page.getByRole('button', { name: /Аренда/ }).click()
  await page.getByRole('button', { name: 'Включить' }).click()
  // Пропущенных платежей нет — спрашивать не о чем
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByText('Активна', { exact: true })).toBeVisible()

  await page.reload()
  await expectTransactions(page, 'Аренда', 1)
})

/**
 * Паузу длиной в дни через интерфейс не сделать — правило всегда начинается
 * не раньше сегодняшнего дня. Поэтому правило на паузе кладётся прямо в
 * IndexedDB: это подготовка данных, а проверяется всё через интерфейс.
 */
test('возобновление в день платежа: число в диалоге не врёт', async ({ page }) => {
  await openApp(page)

  const today = await page.evaluate(() => {
    const iso = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const shift = (days: number) => {
      const date = new Date()
      date.setDate(date.getDate() + days)
      return iso(date)
    }
    return { today: iso(new Date()), tenDaysAgo: shift(-10), fiveDaysAgo: shift(-5) }
  })

  await page.evaluate(async (dates) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('budget')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('recurringTransactions', 'readwrite')
      transaction.objectStore('recurringTransactions').put({
        id: 'e2e-paused',
        type: 'expense',
        amount: 10_000,
        categoryId: 'cat-exp-subscriptions',
        accountId: 'acc-card',
        note: 'Пауза',
        frequency: 'daily',
        interval: 1,
        startDate: dates.tenDaysAgo,
        nextOccurrence: dates.fiveDaysAgo,
        isActive: false,
        createdAt: 1,
        updatedAt: 1,
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })

    database.close()
  }, today)

  await page.reload()
  await goToSettings(page)
  await page.getByRole('button', { name: 'Регулярные операции' }).click()
  await page.getByRole('button', { name: /Пауза/ }).click()
  await page.getByRole('button', { name: 'Включить' }).click()

  // Пять дней паузы — пять пропущенных. Сегодняшний платёж в это число не входит,
  // и приложение говорит об этом прямо
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('пропущено 5 платежей')
  await expect(dialog).toContainText('Сегодняшний платёж будет создан в любом случае')

  await confirmButton(page, 'Не создавать').click()
  await page.reload()

  // Ровно один платёж — сегодняшний, как и было обещано
  await expectTransactions(page, 'Пауза', 1)
})

test('подтверждение удаления правила называет судьбу уже созданных операций', async ({ page }) => {
  await openApp(page)
  await createRule(page, 'Карта', 'Подписка')
  await page.reload()

  await page.getByRole('button', { name: /Подписка/ }).click()
  await page.getByRole('button', { name: 'Удалить', exact: true }).click()

  // Удаляется расписание, а не история: созданная операция остаётся
  await expect(page.getByRole('alertdialog')).toContainText('останется в истории')
  await confirmButton(page, 'Удалить').click()

  await expect(page.getByText('Пока пусто')).toBeVisible()
  await expectTransactions(page, 'Подписка', 1)
})

/**
 * Сколько раз операция с таким комментарием встречается в списке операций.
 * Считаем строго внутри списка: то же слово есть и в названии расписания,
 * и в тостах, и счёт по всей странице ничего бы не доказывал.
 */
async function expectTransactions(page: Page, note: string, count: number) {
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Операции' }).click()
  await expect(page.getByRole('heading', { name: 'Операции' })).toBeVisible()

  // Считаем строки списка, а не вхождения текста: то же слово стоит в названии
  // расписания и мелькает в тостах, и счёт по всей странице ничего бы не доказал
  await expect(page.getByRole('button', { name: new RegExp(`(^|\\s)${note}(\\s|$)`) })).toHaveCount(count)
  await page.goBack()
}
