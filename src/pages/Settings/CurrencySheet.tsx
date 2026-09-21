import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { Sheet } from '../../components/Sheet/Sheet'
import { useToast } from '../../components/Toast/toastContext'
import { settingsRepository } from '../../features/settings/repository'
import type { CurrencyCode } from '../../types/entities'
import { Money } from '../../utils/money'
import { pluralRu } from '../../utils/plural'
import styles from './CurrencySheet.module.css'

const CURRENCIES: readonly { code: CurrencyCode; name: string }[] = [
  { code: 'UAH', name: 'Украинская гривна' },
  { code: 'USD', name: 'Доллар США' },
  { code: 'EUR', name: 'Евро' },
  { code: 'PLN', name: 'Польский злотый' },
]

interface CurrencySheetProps {
  open: boolean
  value: CurrencyCode
  onClose: () => void
}

export function CurrencySheet({ open, value, onClose }: CurrencySheetProps) {
  const toast = useToast()

  const select = async (code: CurrencyCode) => {
    if (code === value) {
      onClose()
      return
    }
    try {
      const updated = await settingsRepository.setBaseCurrency(code)
      onClose()
      toast.show(
        updated > 0
          ? `Валюта изменена, ${updated} ${pluralRu(updated, ['счёт', 'счёта', 'счетов'])} обновлено`
          : 'Валюта изменена',
      )
    } catch {
      toast.show('Не удалось сменить валюту', { tone: 'error' })
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Валюта">
      <p className={styles.note}>
        Меняется только символ — суммы не пересчитываются. Курсов у приложения нет, и данные никуда не отправляются.
      </p>

      <ListCard label="Валюта">
        {CURRENCIES.map((currency) => (
          <ListItem key={currency.code}>
            <ListRow
              icon={Money.currencySymbol(currency.code)}
              title={currency.name}
              subtitle={currency.code}
              value={currency.code === value ? '✓' : undefined}
              onClick={() => void select(currency.code)}
            />
          </ListItem>
        ))}
      </ListCard>
    </Sheet>
  )
}
