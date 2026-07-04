import { Link } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { useCaixaAberto } from './api'
import { cn } from '@/lib/utils'

/** Indicador no cabeçalho: caixa aberto (verde) ou fechado (cinza). */
export function CaixaStatusBadge() {
  const { data: caixa, isLoading } = useCaixaAberto()
  const aberto = !!caixa

  return (
    <Link
      to="/app/caixa"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold',
        isLoading
          ? 'bg-slate-100 text-slate-400'
          : aberto
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-slate-200 text-slate-600',
      )}
    >
      <Wallet className="h-4 w-4" />
      {isLoading ? 'Caixa…' : aberto ? 'Caixa aberto' : 'Caixa fechado'}
    </Link>
  )
}
