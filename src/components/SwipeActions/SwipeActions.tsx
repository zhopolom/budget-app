import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import styles from './SwipeActions.module.css'

export interface SwipeAction {
  label: string
  icon: string
  onAction: () => void
}

interface SwipeActionsProps {
  /** Открывается свайпом вправо. */
  right?: SwipeAction
  /** Открывается свайпом влево. */
  left?: SwipeAction
  children: ReactNode
}

/** Насколько нужно утащить строку, чтобы действие сработало. */
const TRIGGER_DISTANCE = 72
/** До этого порога считаем, что человек листает список, а не свайпает строку. */
const ENGAGE_DISTANCE = 10
/** Дальше порога строка почти не двигается — «резинка» вместо бесконечного хода. */
const MAX_DRAG = 110

/**
 * Свайп по строке операции. Дублирует то, что и так доступно тапом и
 * кнопками в редакторе (ТЗ §37): это ускорение для тех, кто про него знает,
 * а не единственный путь к действию.
 *
 * Написано на pointer-событиях без библиотек: жест простой, а лишние
 * килобайты в бандле дороже.
 */
export function SwipeActions({ right, left, children }: SwipeActionsProps) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const engaged = useRef(false)
  const swiped = useRef(false)

  const reset = () => {
    setOffset(0)
    setDragging(false)
    start.current = null
    engaged.current = false
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Мышь и перо не свайпают: там есть тап и меню
    if (event.pointerType === 'mouse' || (!right && !left)) return
    start.current = { x: event.clientX, y: event.clientY }
    engaged.current = false
    swiped.current = false
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const dx = event.clientX - start.current.x
    const dy = event.clientY - start.current.y

    if (!engaged.current) {
      // Вертикальное движение отдаём списку: прокрутка важнее свайпа
      if (Math.abs(dy) > Math.abs(dx)) {
        start.current = null
        return
      }
      if (Math.abs(dx) < ENGAGE_DISTANCE) return

      engaged.current = true
      setDragging(true)
      // Захват может не удаться, если указатель уже отпущен — жест от этого не ломается
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // без захвата свайп просто оборвётся на pointercancel
      }
    }

    const allowed = dx > 0 ? right : left
    if (!allowed) {
      setOffset(0)
      return
    }

    // Замедление у края: строка не уезжает за пределы разумного
    const clamped = Math.sign(dx) * Math.min(Math.abs(dx), MAX_DRAG + (Math.abs(dx) - MAX_DRAG) * 0.2)
    setOffset(Math.abs(dx) > MAX_DRAG ? clamped : dx)
  }

  const handlePointerUp = () => {
    if (!engaged.current) {
      reset()
      return
    }

    const action = offset > 0 ? right : left
    if (action && Math.abs(offset) >= TRIGGER_DISTANCE) {
      swiped.current = true
      action.onAction()
    }
    reset()
  }

  const revealed = offset > 0 ? right : offset < 0 ? left : undefined
  const armed = revealed !== undefined && Math.abs(offset) >= TRIGGER_DISTANCE

  return (
    <div
      className={styles.row}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={reset}
      // Свайп уже сработал — гасим клик, который браузер шлёт следом
      onClickCapture={(event) => {
        if (!swiped.current) return
        event.preventDefault()
        event.stopPropagation()
        swiped.current = false
      }}
    >
      {revealed && (
        <div className={styles.action} data-side={offset > 0 ? 'right' : 'left'} data-armed={armed || undefined} aria-hidden="true">
          <span className={styles.icon}>{revealed.icon}</span>
          <span className={styles.label}>{revealed.label}</span>
        </div>
      )}

      <div
        className={styles.content}
        data-dragging={dragging || undefined}
        style={{ transform: `translateX(${offset}px)` }}
      >
        {children}
      </div>
    </div>
  )
}
