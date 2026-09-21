import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { navigate, toHref, usePath } from '../../app/navigation'

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/** Обычная ссылка <a>, но переход без перезагрузки страницы. */
export function Link({ to, onClick, ...rest }: LinkProps) {
  return (
    <a
      href={toHref(to)}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || !isPlainClick(event)) return
        event.preventDefault()
        navigate(to)
      }}
      {...rest}
    />
  )
}

interface NavLinkProps extends LinkProps {
  activeClassName: string
  /** Дополнительные пути, на которых ссылка тоже считается активной. */
  alsoActiveOn?: readonly string[]
}

export function NavLink({ to, className, activeClassName, alsoActiveOn = [], ...rest }: NavLinkProps) {
  const path = usePath()
  const isActive = path === to || alsoActiveOn.includes(path)
  return (
    <Link
      to={to}
      className={isActive ? `${className ?? ''} ${activeClassName}` : className}
      aria-current={isActive ? 'page' : undefined}
      {...rest}
    />
  )
}
