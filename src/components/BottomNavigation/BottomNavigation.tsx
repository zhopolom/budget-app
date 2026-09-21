import { Icon, type IconName } from '../Icon/Icon'
import { primeKeyboard } from '../../utils/keyboardPrimer'
import { Link, NavLink } from '../Link/Link'
import styles from './BottomNavigation.module.css'

interface NavItem {
  to: string
  label: string
  icon: IconName
  alsoActiveOn?: readonly string[]
}

const LEFT: readonly NavItem[] = [
  { to: '/', label: 'Главная', icon: 'home' },
  { to: '/transactions', label: 'Операции', icon: 'list', alsoActiveOn: ['/calendar'] },
]

const RIGHT: readonly NavItem[] = [
  { to: '/analytics', label: 'Статистика', icon: 'chart' },
  { to: '/settings', label: 'Настройки', icon: 'settings', alsoActiveOn: ['/accounts', '/account', '/categories', '/budgets', '/recurring'] },
]

function Item({ to, label, icon, alsoActiveOn }: NavItem) {
  return (
    <li>
      <NavLink to={to} className={styles.item} activeClassName={styles.active} alsoActiveOn={alsoActiveOn}>
        <Icon name={icon} />
        <span>{label}</span>
      </NavLink>
    </li>
  )
}

export function BottomNavigation() {
  return (
    <nav className={`${styles.nav} glass`} data-glass="regular" aria-label="Основная навигация">
      <ul className={styles.list}>
        {LEFT.map((item) => (
          <Item key={item.to} {...item} />
        ))}
        <li>
          <Link to="/add" className={styles.add} aria-label="Добавить операцию" onClick={primeKeyboard}>
            <Icon name="plus" size={28} strokeWidth={2.4} />
          </Link>
        </li>
        {RIGHT.map((item) => (
          <Item key={item.to} {...item} />
        ))}
      </ul>
    </nav>
  )
}
