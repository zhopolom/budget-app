import { createContext, useContext } from 'react'

export interface ToastApi {
  show: (message: string, options?: { tone?: 'default' | 'error' }) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const toast = useContext(ToastContext)
  if (!toast) throw new Error('useToast: нет ToastProvider выше по дереву')
  return toast
}
