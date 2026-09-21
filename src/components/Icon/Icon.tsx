export type IconName = 'home' | 'list' | 'plus' | 'chart' | 'settings' | 'close' | 'chevronLeft' | 'chevronRight'

const PATHS: Record<IconName, string> = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
  list: 'M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01',
  plus: 'M12 5v14M5 12h14',
  chart: 'M5 20V11M12 20V4M19 20v-6',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M17 7a2 2 0 1 1-4 0a2 2 0 1 1 4 0M11 17a2 2 0 1 1-4 0a2 2 0 1 1 4 0',
  close: 'M6 6l12 12M18 6 6 18',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
}

interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
}

/** Декоративная иконка: подпись даёт родительский элемент (текст или aria-label). */
export function Icon({ name, size = 24, strokeWidth = 1.9 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
