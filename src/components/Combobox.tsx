import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ComboItem {
  value: string
  label: string
  hint?: string
}

interface ComboboxProps {
  items: ComboItem[]
  value?: string
  onSelect: (value: string, item: ComboItem) => void
  placeholder?: string
  /** Limpa o texto após selecionar (modo "adicionar"). */
  clearOnSelect?: boolean
  autoFocus?: boolean
  className?: string
  emptyLabel?: string
}

/** Select com busca por digitação. Ideal quando há muitos itens. */
export function Combobox({
  items,
  value,
  onSelect,
  placeholder = 'Buscar…',
  clearOnSelect,
  autoFocus,
  className,
  emptyLabel = 'Nada encontrado',
}: ComboboxProps) {
  const selected = items.find((i) => i.value === value)
  const [query, setQuery] = useState(selected?.label ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!clearOnSelect) setQuery(items.find((i) => i.value === value)?.label ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.label.toLowerCase().includes(q) || i.hint?.toLowerCase().includes(q))
  }, [items, query])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function choose(item: ComboItem) {
    onSelect(item.value, item)
    setQuery(clearOnSelect ? '' : item.label)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (open && filtered[active]) choose(filtered[active]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={cn(
            'h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-9 text-slate-900 placeholder:text-slate-400',
            'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200',
            className,
          )}
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>

      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">{emptyLabel}</p>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.value}
                type="button"
                onMouseEnter={() => setActive(idx)}
                onClick={() => choose(item)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm',
                  idx === active ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {item.label}
                  {item.hint && <span className="ml-1 text-xs text-slate-400">{item.hint}</span>}
                </span>
                {item.value === value && <Check className="h-4 w-4 text-brand-600" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
