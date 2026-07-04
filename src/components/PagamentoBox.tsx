import { useMemo, useState } from 'react'
import type { PaymentMethod } from '@/types/db'
import { PAYMENT_LABELS } from '@/types/db'
import { Button, Field, MoneyInput } from '@/components/ui'
import { formatBRL, cn } from '@/lib/utils'

const FORMAS: PaymentMethod[] = ['dinheiro', 'pix', 'debito', 'credito']

export interface PagamentoResultado {
  forma: PaymentMethod
  desconto: number
  valor_recebido: number | null
}

/** Bloco de pagamento reutilizável (PDV e fechamento de comanda). */
export function PagamentoBox({
  subtotal,
  confirmLabel,
  onConfirm,
  disabled,
  loading,
}: {
  subtotal: number
  confirmLabel: string
  onConfirm: (r: PagamentoResultado) => void
  disabled?: boolean
  loading?: boolean
}) {
  const [forma, setForma] = useState<PaymentMethod>('dinheiro')
  const [desconto, setDesconto] = useState(0)
  const [recebido, setRecebido] = useState(0)

  const total = Math.max(0, subtotal - (desconto || 0))
  const troco = forma === 'dinheiro' && recebido > 0 ? recebido - total : null

  const sugestoes = useMemo(() => {
    const vals = new Set<number>()
    if (total > 0) vals.add(total) // exato
    for (const nota of [10, 20, 50, 100]) if (nota > total) vals.add(nota)
    // próxima dezena redonda acima do total
    const prox = Math.ceil(total / 10) * 10
    if (prox > total) vals.add(prox)
    return Array.from(vals).sort((a, b) => a - b).slice(0, 4)
  }, [total])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {FORMAS.map((f) => (
          <button
            key={f}
            onClick={() => setForma(f)}
            className={cn(
              'rounded-xl border px-2 py-2.5 text-sm font-medium',
              forma === f ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
            )}
          >
            {PAYMENT_LABELS[f]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Desconto">
          <MoneyInput value={desconto} onChange={setDesconto} />
        </Field>
        {forma === 'dinheiro' && (
          <Field label="Recebido">
            <MoneyInput value={recebido} onChange={setRecebido} />
          </Field>
        )}
      </div>

      {forma === 'dinheiro' && (
        <div className="flex flex-wrap gap-1.5">
          {sugestoes.map((v) => (
            <button
              key={v}
              onClick={() => setRecebido(v)}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
            >
              {v === total ? 'Exato' : formatBRL(v)}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
        <div className="flex justify-between text-slate-500">
          <span>Subtotal</span><span className="tabular">{formatBRL(subtotal)}</span>
        </div>
        {desconto > 0 && (
          <div className="flex justify-between text-slate-500">
            <span>Desconto</span><span className="tabular">- {formatBRL(desconto)}</span>
          </div>
        )}
        <div className="flex justify-between text-lg font-bold text-slate-900">
          <span>Total</span><span className="tabular">{formatBRL(total)}</span>
        </div>
        {troco != null && troco >= 0 && (
          <div className="flex justify-between font-semibold text-emerald-600">
            <span>Troco</span><span className="tabular">{formatBRL(troco)}</span>
          </div>
        )}
      </div>

      <Button
        size="lg"
        className="w-full"
        disabled={disabled}
        loading={loading}
        onClick={() => onConfirm({
          forma,
          desconto: desconto || 0,
          valor_recebido: forma === 'dinheiro' && recebido > 0 ? recebido : null,
        })}
      >
        {confirmLabel}
      </Button>
    </div>
  )
}
