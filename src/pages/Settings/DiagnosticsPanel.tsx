import { useEffect, useState } from 'react'
import { Button } from '../../components/Button/Button'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { SegmentedControl } from '../../components/SegmentedControl/SegmentedControl'
import { useFps } from '../../features/diagnostics/fps'
import {
  applyGlassBlur,
  currentGlassBlur,
  GLASS_BLUR_OPTIONS,
  type GlassBlurStep,
} from '../../features/diagnostics/glassBlur'
import styles from './DiagnosticsPanel.module.css'

/**
 * Диагностика на живом устройстве. Единственный способ понять, почему на
 * конкретном iPhone дёргается шторка или проседают кадры: в отладчике на
 * ноутбуке этого не видно.
 *
 * Панель открывается семью нажатиями по строке с версией и ничего не
 * отправляет наружу — только показывает то, что уже есть в браузере.
 */
export default function DiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const fps = useFps(true)
  const viewport = useViewportReadout()
  const worker = useServiceWorkerStatus()
  const [blur, setBlur] = useState<GlassBlurStep>(currentGlassBlur)

  const changeBlur = (step: GlassBlurStep) => {
    setBlur(step)
    applyGlassBlur(step)
  }

  return (
    <section className={styles.panel} aria-label="Диагностика">
      <h2 className={styles.title}>Диагностика</h2>

      <ListCard label="Показатели">
        <ListItem>
          <ListRow icon="🎞️" title="Кадров в секунду" value={fps || '—'} />
        </ListItem>
        <ListItem>
          <ListRow icon="📐" title="Экран" subtitle="layout viewport" value={viewport.layout} />
        </ListItem>
        <ListItem>
          <ListRow icon="🔍" title="Видимая область" subtitle="visual viewport" value={viewport.visual} />
        </ListItem>
        <ListItem>
          <ListRow icon="⌨️" title="Клавиатура" subtitle="--keyboard-inset" value={viewport.keyboard} />
        </ListItem>
        <ListItem>
          <ListRow icon="⚙️" title="Service Worker" value={worker} />
        </ListItem>
      </ListCard>

      <div className={styles.blur}>
        <h3 className={styles.blurTitle}>Размытие стекла</h3>
        <SegmentedControl
          options={GLASS_BLUR_OPTIONS}
          value={blur}
          onChange={changeBlur}
          label="Ступень размытия"
        />
        <p className={styles.hint}>Сброс — при перезагрузке страницы.</p>
      </div>

      <Button variant="secondary" block onClick={onClose}>
        Скрыть диагностику
      </Button>
    </section>
  )
}

interface ViewportReadout {
  layout: string
  visual: string
  keyboard: string
}

function readViewport(): ViewportReadout {
  const visual = window.visualViewport
  const inset = getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset').trim()

  return {
    layout: `${Math.round(window.innerWidth)}×${Math.round(window.innerHeight)}`,
    visual: visual
      ? `${Math.round(visual.width)}×${Math.round(visual.height)} ↕${Math.round(visual.offsetTop)} ×${visual.scale.toFixed(2)}`
      : 'нет',
    keyboard: inset === '' ? '0px' : inset,
  }
}

/** Пересчитывается на тех же событиях, что и сама переменная --keyboard-inset. */
function useViewportReadout(): ViewportReadout {
  const [readout, setReadout] = useState(readViewport)

  useEffect(() => {
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setReadout(readViewport())
      })
    }

    const visual = window.visualViewport
    visual?.addEventListener('resize', schedule)
    visual?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('focusin', schedule)
    window.addEventListener('focusout', schedule)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      visual?.removeEventListener('resize', schedule)
      visual?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('focusin', schedule)
      window.removeEventListener('focusout', schedule)
    }
  }, [])

  return readout
}

function useServiceWorkerStatus(): string {
  const supported = 'serviceWorker' in navigator
  const [status, setStatus] = useState(supported ? '…' : 'не поддерживается')

  useEffect(() => {
    if (!supported) return

    let cancelled = false
    const check = async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      if (cancelled) return

      if (!registration) setStatus('не зарегистрирован')
      else if (registration.waiting) setStatus('ждёт обновление')
      else if (navigator.serviceWorker.controller) setStatus('управляет страницей')
      else setStatus('зарегистрирован')
    }

    void check()
    navigator.serviceWorker.addEventListener('controllerchange', check)
    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener('controllerchange', check)
    }
  }, [supported])

  return status
}
