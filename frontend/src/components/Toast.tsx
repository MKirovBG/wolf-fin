// Wolf-Fin Toast — global notification system
// Usage: import { useToast } from './Toast'
//        const toast = useToast()
//        toast.success('Agent saved')
//        toast.error('Something went wrong')

import { createContext, useContext, useState, useCallback, useEffect } from 'react'

type ToastVariant = 'success' | 'error' | 'info'

interface ToastMessage {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  success: (msg: string) => void
  error: (msg: string) => void
  info: (msg: string) => void
}

const ToastContext = createContext<ToastContextValue>({
  success: () => {},
  error: () => {},
  info: () => {},
})

let seq = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const push = useCallback((message: string, variant: ToastVariant) => {
    const id = ++seq
    setToasts(prev => [...prev, { id, message, variant }])
    setTimeout(() => dismiss(id), 3500)
  }, [dismiss])

  const ctx: ToastContextValue = {
    success: (msg) => push(msg, 'success'),
    error:   (msg) => push(msg, 'error'),
    info:    (msg) => push(msg, 'info'),
  }

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {/* Toast stack — top-center */}
      <div
        aria-live="polite"
        className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none"
        style={{ minWidth: 280, maxWidth: 480 }}
      >
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  const [visible, setVisible] = useState(false)

  // Fade in on mount
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const styles: Record<ToastVariant, string> = {
    success: 'border-green/40 bg-[#0d1a10] text-green',
    error:   'border-red/40 bg-[#1a0d0d] text-red',
    info:    'border-blue-500/30 bg-[#0d1120] text-blue-300',
  }

  const icons: Record<ToastVariant, string> = {
    success: '✓',
    error:   '✗',
    info:    'ℹ',
  }

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium shadow-xl transition-all duration-300 ${styles[toast.variant]} ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
      style={{ backdropFilter: 'blur(8px)' }}
    >
      <span className="text-base leading-none">{icons[toast.variant]}</span>
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="opacity-50 hover:opacity-100 transition-opacity leading-none text-base"
      >
        ×
      </button>
    </div>
  )
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}
