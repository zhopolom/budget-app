import type { ElementType, ReactNode } from 'react'

export type GlassDensity = 'subtle' | 'regular' | 'prominent'

interface GlassSurfaceProps {
  /** subtle — мелкие контролы, regular — навигация, prominent — шторки. */
  density?: GlassDensity
  /** Тонкая полупрозрачная кромка. Для прижатых к краю экрана панелей не нужна. */
  bordered?: boolean
  as?: ElementType
  className?: string
  children?: ReactNode
}

/**
 * Обёртка над утилитой .glass для случаев, когда удобнее компонент.
 * Сам материал описан в styles/glass.css — там же токены и запасные варианты,
 * поэтому стекло не приходится прописывать руками в десятках компонентов.
 */
export function GlassSurface({
  density = 'regular',
  bordered = false,
  as: Tag = 'div',
  className,
  children,
  ...rest
}: GlassSurfaceProps & Record<string, unknown>) {
  return (
    <Tag
      className={['glass', className].filter(Boolean).join(' ')}
      data-glass={density}
      data-glass-border={bordered ? '' : undefined}
      {...rest}
    >
      {children}
    </Tag>
  )
}
