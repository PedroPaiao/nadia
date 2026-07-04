import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastTone = 'success' | 'error' | 'info'
interface Toast {
  id: number
  tone: ToastTone
  message: string
}

interface ToastContextValue {
  push: (message: string, tone?: ToastTone) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = ++counter
      setToasts((prev) => [...prev, { id, tone, message }])
      window.setTimeout(() => remove(id), 4000)
    },
    [remove],
  )

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error'),
      info: (m) => push(m, 'info'),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const toneStyles: Record<ToastTone, { bg: string; icon: ReactNode }> = {
  success: { bg: 'bg-emerald-600', icon: <CheckCircle2 className="h-5 w-5" /> },
  error: { bg: 'bg-red-600', icon: <AlertCircle className="h-5 w-5" /> },
  info: { bg: 'bg-slate-800', icon: <Info className="h-5 w-5" /> },
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const s = toneStyles[toast.tone]
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl px-4 py-3 text-white shadow-lg',
        s.bg,
      )}
    >
      {s.icon}
      <span className="flex-1 text-sm font-medium">{toast.message}</span>
      <button onClick={onClose} className="text-white/80 hover:text-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>')
  return ctx
}
