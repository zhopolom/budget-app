import { expect, test } from '@playwright/test'
import { addEntry, addTransfer, expectAmount, monthTile, openApp, totalBalance } from './helpers'

test('расход попадает в баланс и в список операций', async ({ page }) => {
  await openApp(page)
  await expectAmount(totalBalance(page), '0')

  await addEntry(page, { amount: '430', category: 'Продукты', note: 'АТБ' })

  await expectAmount(totalBalance(page), '-430')
  await expectAmount(monthTile(page, 'Расходы'), '-430')
  await expect(page.getByText('АТБ')).toBeVisible()
})

test('перевод между счетами не меняет общий баланс', async ({ page }) => {
  await openApp(page)
  await addEntry(page, { type: 'Доход', amount: '1000', category: 'Зарплата' })
  await expectAmount(totalBalance(page), '1000')

  await addTransfer(page, '400', 'Карта', 'Наличные')

  // Деньги переложены, а не потрачены: капитал прежний, расходов нет
  await expectAmount(totalBalance(page), '1000')
  await expectAmount(monthTile(page, 'Доходы'), '+1000')
  await expectAmount(monthTile(page, 'Расходы'), '0')
  await expect(page.getByText('Карта → Наличные')).toBeVisible()
})
