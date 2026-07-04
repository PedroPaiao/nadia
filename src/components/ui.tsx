import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react'
import { Loader2, X } from 'lucide-react'
import { cn, parseNumber, formatDecimalBR } from '@/lib/utils'

// ---------------- Button ----------------
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-500',
  secondary: 'bg-slate-800 text-white hover:bg-slate-900 focus-visible:ring-slate-500',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
  outline: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:ring-slate-400',
  ghost: 'text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-400',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-14 px-6 text-base',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

// ---------------- Label ----------------
export function Label({ children, className, htmlFor }: { children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1 block text-sm font-medium text-slate-700', className)}>
      {children}
    </label>
  )
}

// ---------------- Input ----------------
const fieldBase =
  'w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-900 placeholder:text-slate-400 ' +
  'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-100'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldBase, 'h-11', className)} {...props} />
  ),
)
Input.displayName = 'Input'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(fieldBase, 'h-11 appearance-none pr-8', className)} {...props}>
      {children}
    </select>
  ),
)
Select.displayName = 'Select'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldBase, 'min-h-[80px] py-2', className)} {...props} />
  ),
)
Textarea.displayName = 'Textarea'

// ---------------- MoneyInput ----------------
// Entrada monetária em R$ que aceita vírgula (pt-BR). Guarda o número no pai;
// exibe o texto digitado e formata com 2 casas ao sair do campo. Nunca aceita negativo.
interface MoneyInputProps {
  value: number
  onChange: (n: number) => void
  className?: string
  autoFocus?: boolean
  placeholder?: string
  id?: string
  disabled?: boolean
}

export function MoneyInput({ value, onChange, className, autoFocus, placeholder = '0,00', id, disabled }: MoneyInputProps) {
  const [text, setText] = useState(() => (value ? formatDecimalBR(value) : ''))
  const ultimoEmitido = useRef(value)

  // Sincroniza quando o valor muda por fora (ex.: reset do formulário).
  useEffect(() => {
    if (value !== ultimoEmitido.current) {
      setText(value ? formatDecimalBR(value) : '')
      ultimoEmitido.current = value
    }
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^\d.,]/g, '') // sem sinal negativo
    setText(raw)
    const n = parseNumber(raw)
    ultimoEmitido.current = n
    onChange(n)
  }

  function handleBlur() {
    const n = parseNumber(text)
    setText(n ? formatDecimalBR(n) : '')
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">R$</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        autoFocus={autoFocus}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(fieldBase, 'h-11 pl-9 text-right tabular-nums', className)}
      />
    </div>
  )
}

// ---------------- NumberInput (quantidades) ----------------
// Quantidade numérica; inteiro por padrão, permite decimais quando `decimais` > 0.
export function NumberInput({
  value,
  onChange,
  decimais = 0,
  min = 0,
  className,
  autoFocus,
  id,
}: {
  value: number
  onChange: (n: number) => void
  decimais?: number
  min?: number
  className?: string
  autoFocus?: boolean
  id?: string
}) {
  const [text, setText] = useState(() => (value ? String(value).replace('.', ',') : ''))
  const ultimoEmitido = useRef(value)

  useEffect(() => {
    if (value !== ultimoEmitido.current) {
      setText(value ? String(value).replace('.', ',') : '')
      ultimoEmitido.current = value
    }
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const permitido = decimais > 0 ? /[^\d.,]/g : /[^\d]/g
    const raw = e.target.value.replace(permitido, '')
    setText(raw)
    const n = parseNumber(raw)
    ultimoEmitido.current = n
    onChange(n)
  }

  return (
    <input
      id={id}
      type="text"
      inputMode={decimais > 0 ? 'decimal' : 'numeric'}
      value={text}
      onChange={handleChange}
      autoFocus={autoFocus}
      min={min}
      placeholder="0"
      className={cn(fieldBase, 'h-11', className)}
    />
  )
}

// ---------------- Card ----------------
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl border border-slate-200 bg-white shadow-sm', className)}>{children}</div>
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ---------------- Badge ----------------
type BadgeTone = 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'brand'
const badgeTones: Record<BadgeTone, string> = {
  gray: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-800',
  brand: 'bg-brand-100 text-brand-800',
}
export function Badge({ children, tone = 'gray', className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', badgeTones[tone], className)}>
      {children}
    </span>
  )
}

// ---------------- Spinner / estados ----------------
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-brand-600', className)} />
}

export function CenterSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
      <Spinner className="h-8 w-8" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// ---------------- Modal ----------------
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  if (!open) return null
  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={cn('w-full rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', sizes[size])}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">{footer}</div>}
      </div>
    </div>
  )
}

// ---------------- Field wrapper ----------------
export function Field({ label, children, hint, error }: { label?: string; children: ReactNode; hint?: string; error?: string }) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      {children}
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  )
}
