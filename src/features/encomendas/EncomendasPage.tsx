import { useState } from 'react'
import {
  Plus, CalendarClock, CheckCircle2, DollarSign, Pencil, XCircle, Trash2,
  AlertTriangle, MessageCircle, Truck, Store,
} from 'lucide-react'
import {
  useEncomendas, useContasReceber, useMudarStatusEncomenda, useExcluirEncomenda, type OrderComItens,
} from './api'
import { EncomendaForm } from './EncomendaForm'
import type { OrderStatus, OrderPaymentMethod } from '@/types/db'
import { ORDER_STATUS_LABELS, ORDER_PAYMENT_LABELS } from '@/types/db'
import { Button, Card, CenterSpinner, EmptyState, Field, Select, Modal, Badge } from '@/components/ui'
import { DatePicker } from '@/components/DateTimePicker'
import { useAuth } from '@/auth/AuthProvider'
import { useToast } from '@/components/toast'
import { formatBRL, formatDataBR, hojeData, hojeMaisDias, cn } from '@/lib/utils'

type Aba = 'pendente' | 'entregue' | 'pago' | 'todas'
const ABAS: { key: Aba; label: string }[] = [
  { key: 'pendente', label: 'Pendentes' },
  { key: 'entregue', label: 'A receber' },
  { key: 'pago', label: 'Pagas' },
  { key: 'todas', label: 'Todas' },
]

const PAGINA = 30

export function EncomendasPage() {
  const [aba, setAba] = useState<Aba>('pendente')
  const [limite, setLimite] = useState(PAGINA)
  const [criando, setCriando] = useState(false)
  const [editando, setEditando] = useState<OrderComItens | null>(null)
  const { data, isLoading } = useEncomendas(aba === 'todas' ? undefined : aba, limite)
  const { data: contas } = useContasReceber()

  const encomendas = data?.rows ?? []
  const total = data?.total ?? 0

  function trocarAba(a: Aba) {
    setAba(a)
    setLimite(PAGINA)
  }

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
            onClick={() => trocarAba(a.key)}
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
      ) : encomendas.length === 0 ? (
        <Card><EmptyState title="Nenhuma encomenda" description="Lance a primeira encomenda agendada." /></Card>
      ) : (
        <div className="space-y-3">
          {encomendas.map((e) => (
            <EncomendaCard key={e.id} encomenda={e} onEditar={() => setEditando(e)} />
          ))}
          {encomendas.length < total && (
            <div className="flex flex-col items-center gap-1 pt-2">
              <Button variant="outline" onClick={() => setLimite((l) => l + PAGINA)}>
                Carregar mais ({total - encomendas.length} restantes)
              </Button>
            </div>
          )}
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
  const { isAdmin } = useAuth()
  const mudar = useMudarStatusEncomenda()
  const excluir = useExcluirEncomenda()
  const [entregarOpen, setEntregarOpen] = useState(false)
  const [pagarOpen, setPagarOpen] = useState(false)

  const vencido = e.status === 'entregue' && e.data_prevista_pagamento != null && e.data_prevista_pagamento < hojeData()
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

  async function apagar() {
    if (!confirm(`Excluir a encomenda de "${e.cliente_nome}" permanentemente? Não dá para desfazer.`)) return
    try {
      await excluir.mutateAsync(e.id)
      toast.success('Encomenda excluída.')
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
            {isAdmin && (
              <button onClick={apagar} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Excluir (apagar de vez)">
                <Trash2 className="h-4 w-4" />
              </button>
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
  const [recebido, setRecebido] = useState(false)
  const [forma, setForma] = useState<OrderPaymentMethod>('dinheiro')
  const [previsao, setPrevisao] = useState(encomenda.data_prevista_pagamento ?? '')

  async function confirmar() {
    try {
      if (recebido) {
        await mudar.mutateAsync({ id: encomenda.id, status: 'pago', forma_pagamento: forma })
        toast.success('Entregue e pago! ✅')
      } else {
        await mudar.mutateAsync({ id: encomenda.id, status: 'entregue', data_prevista_pagamento: previsao || undefined })
        toast.success('Encomenda entregue.')
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.')
    }
  }

  const atalhos = [
    { label: 'Hoje', dias: 0 },
    { label: '+15 dias', dias: 15 },
    { label: '+20 dias', dias: 20 },
    { label: '+30 dias', dias: 30 },
  ]

  return (
    <Modal
      open onClose={onClose} onSubmit={confirmar} title="Marcar como entregue" size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} loading={mudar.isPending}>
            <CheckCircle2 className="h-4 w-4" /> {recebido ? 'Entregar e receber' : 'Confirmar entrega'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
          <span className="flex items-center gap-2 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
              {encomenda.tipo_entrega === 'entrega' ? <Truck className="h-4 w-4" /> : <Store className="h-4 w-4" />}
            </span>
            <span className="truncate text-sm font-medium text-slate-700">{encomenda.cliente_nome}</span>
          </span>
          <span className="shrink-0 font-bold tabular text-slate-900">{formatBRL(encomenda.total)}</span>
        </div>

        {/* Já recebeu? */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setRecebido(true)}
            className={cn('rounded-xl border px-3 py-2.5 text-sm font-semibold transition',
              recebido ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
          >
            💰 Recebi agora
          </button>
          <button
            onClick={() => setRecebido(false)}
            className={cn('rounded-xl border px-3 py-2.5 text-sm font-semibold transition',
              !recebido ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
          >
            ⏳ Vai pagar depois
          </button>
        </div>

        {recebido ? (
          <Field label="Forma de pagamento">
            <Select value={forma} onChange={(e) => setForma(e.target.value as OrderPaymentMethod)}>
              {FORMAS_ENCOMENDA.map((f) => (
                <option key={f} value={f}>{ORDER_PAYMENT_LABELS[f]}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Quando o cliente vai pagar?" hint="opcional">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {atalhos.map((a) => {
                const val = hojeMaisDias(a.dias)
                return (
                  <button
                    key={a.label}
                    onClick={() => setPrevisao(val)}
                    className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition',
                      previsao === val ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}
                  >
                    {a.label}
                  </button>
                )
              })}
            </div>
            <DatePicker value={previsao} onChange={setPrevisao} />
          </Field>
        )}

        <p className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-xs',
          recebido ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>
          <DollarSign className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {recebido
            ? <>Vai direto para <b>&ldquo;Pagas&rdquo;</b> — nada fica em aberto.</>
            : <>Fica em <b>&ldquo;A receber&rdquo;</b> até você marcar como paga (ideal para licitação).</>}
        </p>
      </div>
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
