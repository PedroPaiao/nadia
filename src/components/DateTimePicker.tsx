import { useEffect, useRef, useState } from 'react'
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn, formatDataBR, hojeData, toISODate } from '@/lib/utils'

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onOutside])
  return ref
}

// ---------------- DatePicker ----------------
export function DatePicker({
  value,
  onChange,
  placeholder = 'dd/mm/aaaa',
  className,
  clearable = true,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  clearable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(() => setOpen(false))

  const selected = value ? new Date(`${value}T00:00:00`) : null
  const base = selected ?? new Date(`${hojeData()}T00:00:00`)
  const [view, setView] = useState(() => new Date(base.getFullYear(), base.getMonth(), 1))

  // Ressincroniza o mês exibido ao abrir ou quando o valor muda por fora.
  useEffect(() => {
    if (!open) return
    const b = value ? new Date(`${value}T00:00:00`) : new Date(`${hojeData()}T00:00:00`)
    setView(new Date(b.getFullYear(), b.getMonth(), 1))
  }, [open, value])

  const y = view.getFullYear()
  const m = view.getMonth()
  const startWeekday = new Date(y, m, 1).getDay()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const hoje = hojeData()

  const cells: (Date | null)[] = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d))

  function pick(d: Date) {
    onChange(toISODate(d))
    setOpen(false)
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-left text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
      >
        <CalendarIcon className="h-4 w-4 shrink-0 text-slate-400" />
        <span className={cn('flex-1 truncate', !value && 'text-slate-400')}>
          {value ? formatDataBR(value) : placeholder}
        </span>
        {clearable && value && (
          <X
            className="h-4 w-4 shrink-0 text-slate-300 hover:text-slate-500"
            onClick={(e) => { e.stopPropagation(); onChange('') }}
          />
        )}
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setView(new Date(y, m - 1, 1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold capitalize text-slate-800">{MESES[m]} {y}</span>
            <button type="button" onClick={() => setView(new Date(y, m + 1, 1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w, i) => (
              <span key={i} className="py-1 text-xs font-medium text-slate-400">{w}</span>
            ))}
            {cells.map((d, i) => {
              if (!d) return <span key={i} />
              const iso = toISODate(d)
              const isSel = value === iso
              const isHoje = hoje === iso
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => pick(d)}
                  className={cn(
                    'aspect-square rounded-lg text-sm',
                    isSel ? 'bg-brand-600 font-semibold text-white' : 'text-slate-700 hover:bg-slate-100',
                    !isSel && isHoje && 'ring-1 ring-brand-300',
                  )}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex justify-between border-t border-slate-100 pt-2">
            <button type="button" onClick={() => pick(new Date(`${hoje}T00:00:00`))} className="rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50">
              Hoje
            </button>
            {clearable && (
              <button type="button" onClick={() => { onChange(''); setOpen(false) }} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
                Limpar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------- TimePicker ----------------
function gerarHorarios(): string[] {
  const out: string[] = []
  for (let h = 6; h <= 23; h++) {
    for (const mm of [0, 30]) {
      out.push(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`)
    }
  }
  return out
}
const HORARIOS = gerarHorarios()

export function TimePicker({
  value,
  onChange,
  placeholder = '--:--',
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const ref = useClickOutside(() => { setOpen(false); setQuery(value) })

  useEffect(() => { setQuery(value) }, [value])

  function handleInput(v: string) {
    // permite dígitos e ":" e formata HH:MM
    let s = v.replace(/[^\d:]/g, '')
    if (s.length === 2 && !s.includes(':') && query.length < s.length) s = s + ':'
    if (s.length > 5) s = s.slice(0, 5)
    setQuery(s)
    setOpen(true)
    const m = /^(\d{2}):(\d{2})$/.exec(s)
    if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) onChange(s)
  }

  const filtrados = query ? HORARIOS.filter((h) => h.startsWith(query.replace(/[^\d:]/g, ''))) : HORARIOS

  return (
    <div ref={ref} className={cn('relative', className)}>
      <div className="relative">
        <Clock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          inputMode="numeric"
          className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-8 text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        {value && (
          <button type="button" onClick={() => { onChange(''); setQuery('') }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && filtrados.length > 0 && (
        <div className="absolute z-40 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {filtrados.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => { onChange(h); setQuery(h); setOpen(false) }}
              className={cn('w-full px-3 py-1.5 text-left text-sm', h === value ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50')}
            >
              {h}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
