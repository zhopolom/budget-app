import { useLiveQuery } from 'dexie-react-hooks'
import { navigate } from '../../app/navigation'
import { Banner } from '../../components/Banner/Banner'
import { Button } from '../../components/Button/Button'
import { db } from '../../db/database'
import { RECOVERED_ACCOUNT_ID } from '../../db/repair'

/**
 * Появляется, если ремонт данных создал «Восстановленный счёт»: значит, в базе
 * были операции на счёт, удалённый багом v0.2. Исчезает сам, как только
 * пользователь перенесёт их и удалит этот счёт обычным способом.
 */
export function RecoveredAccountBanner() {
  const recovered = useLiveQuery(() => db.accounts.get(RECOVERED_ACCOUNT_ID), [])
  if (!recovered) return null

  return (
    <Banner
      icon="🛟"
      tone="attention"
      title="Найдены операции без счёта"
      text="Они перенесены в «Восстановленный счёт». Проверьте их и перенесите туда, где им место."
      actions={
        <Button onClick={() => navigate(`/account?id=${encodeURIComponent(RECOVERED_ACCOUNT_ID)}`)}>
          Открыть счёт
        </Button>
      }
    />
  )
}
