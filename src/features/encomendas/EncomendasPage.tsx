import { useState } from 'react'
import {
  Plus, CalendarClock, CheckCircle2, DollarSign, Pencil, XCircle,
  AlertTriangle, MessageCircle, Truck, Store,
} from 'lucide-react'
import {
  useEncomendas, useContasReceber, useMudarStatusEncomenda, type OrderComItens,
} from './api'
import { EncomendaForm } from './EncomendaForm'
import type { OrderStatus, OrderPaymentMethod } from '@/types/db'
import { ORDER_STATUS_LABELS, ORDER_PAYMENT_LABELS } from '@/types/db'
import { Button, Card, CenterSpinner, EmptyState, Field, Select, Input, Modal, Badge } from '@/components/ui'
import { useToast } from '@/components/toast'
import { formatBRL, formatDataBR, hojeMaisDias, cn } from '@/lib/utils'

type Aba = 'pendente' | 'entregue' | 'pago' | 'todas'
const ABAS: { key: Aba; label: string }[] = [
  { key: 'pendente', label: 'Pendentes' },
  { key: 'entregue', label: 'A receber' },
  { key: 'pago', label: 'Pagas' },
  { key: 'todas', label: 'Todas' },
]

export function EncomendasPage() {
  const [aba, setAba] = useState<Aba>('pendente')
  const [criando, setCriando] = useState(false)
  const [editando, setEditando] = useState<OrderComItens | null>(null)
  const { data: encomendas, isLoading } = useEncomendas(aba === 'todas' ? undefined : aba)
  const { data: contas } = useContasReceber()

  const totalReceber = (contas ?? []).reduce((a, c) => a + Number(c.total), 0)
  const vencidos = (contas ?? []).filter((c) => c.vencido)

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Encomendas</h1>
        <Button onClick={() => setCriando(true)}>
          <Plus className="h-4 w-4" /> Nova encomenda
        </Button>
      </div>

      {/* Aviso: contas a receber */}
      {contas && contas.length > 0 && (
        <Card className={cn('border-2', vencidos.length > 0 ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50')}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className={cn('flex items-center gap-2 font-semibold', vencidos.length > 0 ? 'text-red-800' : 'text-amber-800')}>
                <AlertTriangle className="h-5 w-5" /> A receber de encomendas
              </p>
              <p className="mt-0.5 text-sm text-slate-600">
                {contas.length} pedido(s) entregue(s) aguardando pagamento
                {vencidos.length > 0 && <span className="font-semibold text-red-700"> • {vencidos.length} vencido(s)</span>}
              </p>
            </div>
            <p className="text-2xl font-bold tabular text-slate-900">{formatBRL(totalReceber)}</p>
          </div>
        </Card>
      )}

      {/* Abas */}
      <div className="flex flex-wrap gap-2">
        {ABAS.map((a) => (
          <button
            key={a.key}
            onClick={() => setAba(a.key)}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition',
              aba === a.key ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100',
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <CenterSpinner />
      ) : !encomendas || encomendas.length === 0 ? (
        <Card><EmptyState title="Nenhuma encomenda" description="Lance a primeira encomenda agendada." /></Card>
      ) : (
        <div className="space-y-3">
          {encomendas.map((e) => (
            <EncomendaCard key={e.id} encomenda={e} onEditar={() => setEditando(e)} />
          ))}
        </div>
      )}

      {criando && <EncomendaForm onClose={() => setCriando(false)} />}
      {editando && <EncomendaForm encomenda={editando} onClose={() => setEditando(null)} />}
    </div>
  )
}

const statusTone: Record<OrderStatus, 'amber' | 'blue' | 'green' | 'gray'> = {
  pendente: 'amber',
  entregue: 'blue',
  pago: 'green',
  cancelado: 'gray',
}

function EncomendaCard({ encomenda: e, onEditar }: { encomenda: OrderComItens; onEditar: () => void }) {
  const toast = useToast()
  const mudar = useMudarStatusEncomenda()
  const [entregarOpen, setEntregarOpen] = useState(false)
  const [pagarOpen, setPagarOpen] = useState(false)

  const vencido = e.status === 'entregue' && e.data_prevista_pagamento != null && e.data_prevista_pagamento < hojeMaisDias(0)
  const whatsappDigits = e.cliente_whatsapp?.replace(/\D/g, '')

  async function cancelar() {
    if (!confirm('Cancelar esta encomenda?')) return
    try {
      await mudar.mutateAsync({ id: e.id, status: 'cancelado' })
      toast.success('Encomenda cancelada.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.')
    }
  }

  return (
    <Card className={cn(e.status === 'cancelado' && 'opacity-60')}>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{e.cliente_nome}</span>
            <Badge tone={statusTone[e.status]}>{ORDER_STATUS_LABELS[e.status]}</Badge>
            {vencido && <Badge tone="red">Vencido</Badge>}
            <span className="inline-flex items-center gap-1 text-xs text-slate-400">
              {e.tipo_entrega === 'entrega' ? <Truck className="h-3.5 w-3.5" /> : <Store className="h-3.5 w-3.5" />}
              {e.tipo_entrega}
            </span>
          </div>

          {e.descricao && <p className="mt-1 text-sm text-slate-600">{e.descricao}</p>}
          {e.order_items.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {e.order_items.map((i) => `${i.quantidade}× ${i.product_nome}`).join(' · ')}
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {e.data_agendada && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" /> {formatDataBR(e.data_agendada)}
                {e.hora_agendada && ` ${e.hora_agendada.slice(0, 5)}`}
              </span>
            )}
            {e.status === 'entregue' && e.data_prevista_pagamento && (
              <span className={cn('inline-flex items-center gap-1', vencido && 'font-semibold text-red-600')}>
                <DollarSign className="h-3.5 w-3.5" /> receber até {formatDataBR(e.data_prevista_pagamento)}
              </span>
            )}
            {e.status === 'pago' && e.forma_pagamento && (
              <span>pago • {ORDER_PAYMENT_LABELS[e.forma_pagamento]}</span>
            )}
            {whatsappDigits && (
              <a
                href={`https://wa.me/55${whatsappDigits}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-emerald-600 hover:underline"
              >
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end">
          <span className="text-lg font-bold tabular text-slate-900">{formatBRL(e.total)}</span>
          <div className="flex gap-1">
            {e.status === 'pendente' && (
              <>
                <Button size="sm" variant="outline" onClick={() => setEntregarOpen(true)}>
                  <CheckCircle2 className="h-4 w-4 text-blue-600" /> Entregar
                </Button>
                <button onClick={onEditar} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Editar">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={cancelar} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Cancelar">
                  <XCircle className="h-4 w-4" />
                </button>
              </>
            )}
            {e.status === 'entregue' && (
              <>
                <Button size="sm" onClick={() => setPagarOpen(true)}>
                  <DollarSign className="h-4 w-4" /> Marcar pago
                </Button>
                <button onClick={cancelar} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Cancelar">
                  <XCircle className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {entregarOpen && <EntregarModal encomenda={e} onClose={() => setEntregarOpen(false)} />}
      {pagarOpen && <PagarModal encomenda={e} onClose={() => setPagarOpen(false)} />}
    </Card>
  )
}

function EntregarModal({ encomenda, onClose }: { encomenda: OrderComItens; onClose: () => void }) {
  const toast = useToast()
  const mudar = useMudarStatusEncomenda()
  const [previsao, setPrevisao] = useState(encomenda.data_prevista_pagamento ?? '')

  async function confirmar() {
    try {
      await mudar.mutateAsync({ id: encomenda.id, status: 'entregue', data_prevista_pagamento: previsao || undefined })
      toast.success('Encomenda marcada como entregue.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.')
    }
  }

  return (
    <Modal
      open onClose={onClose} title="Marcar como entregue" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={confirmar} loading={mudar.isPending}>Confirmar entrega</Button></>}
    >
      <Field label="Previsão de pagamento" hint="quando o cliente vai pagar (licitação: alguns dias depois)">
        <div className="flex gap-2">
          <Input type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} />
          <Button variant="outline" size="sm" onClick={() => setPrevisao(hojeMaisDias(20))} className="whitespace-nowrap">+20 dias</Button>
        </div>
      </Field>
      <p className="mt-3 text-xs text-slate-500">Deixe em branco se o pagamento é imediato. Ficará em "A receber" até você marcar como pago.</p>
    </Modal>
  )
}

const FORMAS_ENCOMENDA: OrderPaymentMethod[] = ['transferencia', 'pix', 'dinheiro', 'debito', 'credito', 'boleto', 'outro']

function PagarModal({ encomenda, onClose }: { encomenda: OrderComItens; onClose: () => void }) {
  const toast = useToast()
  const mudar = useMudarStatusEncomenda()
  const [forma, setForma] = useState<OrderPaymentMethod>('transferencia')

  async function confirmar() {
    try {
      await mudar.mutateAsync({ id: encomenda.id, status: 'pago', forma_pagamento: forma })
      toast.success('Pagamento registrado!')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.')
    }
  }

  return (
    <Modal
      open onClose={onClose} title="Registrar pagamento" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={confirmar} loading={mudar.isPending}>Confirmar pagamento</Button></>}
    >
      <div className="space-y-1">
        <p className="text-sm text-slate-600">Valor: <span className="font-bold text-slate-900">{formatBRL(encomenda.total)}</span></p>
        <Field label="Forma de pagamento">
          <Select value={forma} onChange={(e) => setForma(e.target.value as OrderPaymentMethod)}>
            {FORMAS_ENCOMENDA.map((f) => (
              <option key={f} value={f}>{ORDER_PAYMENT_LABELS[f]}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}
