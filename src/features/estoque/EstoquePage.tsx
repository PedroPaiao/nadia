import { useMemo, useState } from 'react'
import {
  PackagePlus, AlertTriangle, ArrowDownCircle, ArrowUpCircle, SlidersHorizontal,
  Boxes, PackageX, PackageCheck, Plus,
} from 'lucide-react'
import { useMovimentosEstoque, useRegistrarMovimento } from './api'
import { useProducts } from '@/features/produtos/api'
import type { MovementType, Product } from '@/types/db'
import { Button, Card, CardHeader, CenterSpinner, EmptyState, Input, Field, Badge, Modal, NumberInput } from '@/components/ui'
import { Combobox } from '@/components/Combobox'
import { useToast } from '@/components/toast'
import { formatQty, unidadeLabel, cn } from '@/lib/utils'

const TIPO_LABEL: Record<MovementType, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  ajuste: 'Ajuste',
  venda: 'Venda',
  cancelamento: 'Estorno',
}

type StatusEstoque = 'falta' | 'baixo' | 'ok'

function statusDe(p: Product): StatusEstoque {
  if (p.estoque_atual <= 0) return 'falta'
  if (p.estoque_atual <= p.estoque_minimo) return 'baixo'
  return 'ok'
}

export function EstoquePage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [preSelecionado, setPreSelecionado] = useState<string | undefined>()
  const { data: produtos, isLoading: loadingProd } = useProducts()
  const { data: movimentos, isLoading } = useMovimentosEstoque()

  const controlados = useMemo(() => (produtos ?? []).filter((p) => p.controla_estoque), [produtos])
  const ordenados = useMemo(() => {
    const rank = { falta: 0, baixo: 1, ok: 2 }
    return [...controlados].sort((a, b) => rank[statusDe(a)] - rank[statusDe(b)] || a.nome.localeCompare(b.nome))
  }, [controlados])

  const emFalta = controlados.filter((p) => statusDe(p) === 'falta').length
  const baixoCount = controlados.filter((p) => statusDe(p) === 'baixo').length
  const okCount = controlados.filter((p) => statusDe(p) === 'ok').length

  function abrirModal(productId?: string) {
    setPreSelecionado(productId)
    setModalOpen(true)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Estoque</h1>
        <Button onClick={() => abrirModal()}>
          <PackagePlus className="h-4 w-4" /> Movimentar estoque
        </Button>
      </div>

      {/* Dashboard */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DashCard label="Produtos" value={controlados.length} icon={<Boxes className="h-5 w-5" />} tone="slate" />
        <DashCard label="Em falta" value={emFalta} icon={<PackageX className="h-5 w-5" />} tone="red" active={emFalta > 0} />
        <DashCard label="Estoque baixo" value={baixoCount} icon={<AlertTriangle className="h-5 w-5" />} tone="amber" active={baixoCount > 0} />
        <DashCard label="Em dia" value={okCount} icon={<PackageCheck className="h-5 w-5" />} tone="green" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Situação do estoque" subtitle="Quando o saldo chega ao mínimo, o produto entra em alerta (aqui, no PDV e nos produtos)." />
        {loadingProd ? (
          <CenterSpinner />
        ) : ordenados.length === 0 ? (
          <EmptyState title="Nenhum produto com controle de estoque" />
        ) : (
          <div className="divide-y divide-slate-100">
            {ordenados.map((p) => (
              <LinhaEstoque key={p.id} produto={p} onRepor={() => abrirModal(p.id)} />
            ))}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Movimentações recentes" subtitle="Últimos 100 lançamentos" />
        {isLoading ? (
          <CenterSpinner />
        ) : !movimentos || movimentos.length === 0 ? (
          <EmptyState title="Sem movimentações" description="Registre entradas ou ajustes de estoque." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3 text-right">Qtd</th>
                  <th className="px-4 py-3 text-right">Saldo</th>
                  <th className="px-4 py-3">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movimentos.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">
                      {new Date(m.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{m.products?.nome ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <MovimentoBadge tipo={m.tipo} />
                    </td>
                    <td className={`px-4 py-2.5 text-right font-semibold tabular ${m.quantidade < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {m.quantidade > 0 ? '+' : ''}{formatQty(m.quantidade)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular text-slate-600">
                      {m.estoque_apos != null ? formatQty(m.estoque_apos) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{m.motivo ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modalOpen && <MovimentoModal initialProductId={preSelecionado} onClose={() => setModalOpen(false)} />}
    </div>
  )
}

function DashCard({ label, value, icon, tone, active }: {
  label: string; value: number; icon: React.ReactNode; tone: 'slate' | 'red' | 'amber' | 'green'; active?: boolean
}) {
  const tones = {
    slate: 'bg-white text-slate-900',
    red: active ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white text-slate-900',
    amber: active ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white text-slate-900',
    green: 'bg-white text-slate-900',
  }
  const iconTone = { slate: 'text-slate-300', red: 'text-red-400', amber: 'text-amber-400', green: 'text-emerald-400' }
  return (
    <Card className={cn('flex items-center justify-between p-4', tones[tone])}>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-0.5 text-2xl font-bold tabular">{value}</p>
      </div>
      <span className={iconTone[tone]}>{icon}</span>
    </Card>
  )
}

function LinhaEstoque({ produto: p, onRepor }: { produto: Product; onRepor: () => void }) {
  const status = statusDe(p)
  const alvo = Math.max(p.estoque_minimo * 1.5, p.estoque_atual, 1)
  const pct = Math.min((p.estoque_atual / alvo) * 100, 100)
  const barColor = status === 'falta' ? 'bg-red-500' : status === 'baixo' ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between text-sm">
          <span className="truncate font-medium text-slate-800">{p.nome}</span>
          <span className={cn('tabular', status === 'falta' ? 'text-red-600 font-semibold' : status === 'baixo' ? 'text-amber-600 font-semibold' : 'text-slate-500')}>
            {formatQty(p.estoque_atual)} <span className="font-normal text-slate-400">/ mín {formatQty(p.estoque_minimo)} {unidadeLabel(p.unidade)}</span>
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className={cn('h-full rounded-full', barColor)} style={{ width: `${Math.max(pct, 3)}%` }} />
        </div>
      </div>
      {status !== 'ok' && (
        <Button size="sm" variant="outline" onClick={onRepor} className="shrink-0">
          <Plus className="h-4 w-4" /> Repor
        </Button>
      )}
    </div>
  )
}

function MovimentoBadge({ tipo }: { tipo: MovementType }) {
  const tone = tipo === 'venda' || tipo === 'saida' ? 'red' : tipo === 'ajuste' ? 'amber' : 'green'
  return <Badge tone={tone as 'red' | 'amber' | 'green'}>{TIPO_LABEL[tipo]}</Badge>
}

type Modo = 'entrada' | 'saida' | 'ajuste'

function MovimentoModal({ onClose, initialProductId }: { onClose: () => void; initialProductId?: string }) {
  const toast = useToast()
  const { data: produtos } = useProducts()
  const registrar = useRegistrarMovimento()

  const controlados = useMemo(() => (produtos ?? []).filter((p) => p.controla_estoque), [produtos])
  const [productId, setProductId] = useState(initialProductId ?? '')
  const [modo, setModo] = useState<Modo>('entrada')
  const [valor, setValor] = useState(0)
  const [motivo, setMotivo] = useState('')

  const produto: Product | undefined = controlados.find((p) => p.id === productId)

  async function salvar() {
    if (!productId) return toast.error('Escolha um produto.')
    if (Number(valor) < 0) return toast.error('Quantidade não pode ser negativa.')
    const inteiro = produto && produto.unidade !== 'kg'
    if (inteiro && !Number.isInteger(Number(valor))) {
      return toast.error('Quantidade deve ser um número inteiro para esta unidade.')
    }

    let quantidade = valor
    let tipo: MovementType = 'entrada'
    if (modo === 'entrada') {
      if (!valor || valor <= 0) return toast.error('Informe uma quantidade maior que zero.')
      tipo = 'entrada'; quantidade = valor
    } else if (modo === 'saida') {
      if (!valor || valor <= 0) return toast.error('Informe uma quantidade maior que zero.')
      tipo = 'saida'; quantidade = -valor
    } else if (modo === 'ajuste') {
      // valor = novo saldo contado (pode ser 0)
      tipo = 'ajuste'
      quantidade = valor - (produto?.estoque_atual ?? 0)
      if (quantidade === 0) return toast.error('O saldo informado é igual ao atual.')
    }

    try {
      await registrar.mutateAsync({ product_id: productId, tipo, quantidade, motivo: motivo.trim() || undefined })
      toast.success('Estoque atualizado.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao registrar.')
    }
  }

  const modos: { key: Modo; label: string; icon: typeof ArrowUpCircle }[] = [
    { key: 'entrada', label: 'Entrada', icon: ArrowUpCircle },
    { key: 'saida', label: 'Saída/Perda', icon: ArrowDownCircle },
    { key: 'ajuste', label: 'Ajuste', icon: SlidersHorizontal },
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title="Movimentar estoque"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} loading={registrar.isPending}>Registrar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Produto">
          <Combobox
            items={controlados.map((p) => ({ value: p.id, label: p.nome, hint: `atual: ${formatQty(p.estoque_atual)}` }))}
            value={productId}
            onSelect={(id) => setProductId(id)}
            placeholder="Buscar produto…"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-3 gap-2">
          {modos.map((m) => {
            const Icon = m.icon
            const active = modo === m.key
            return (
              <button
                key={m.key}
                onClick={() => setModo(m.key)}
                className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-medium ${
                  active ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-5 w-5" />
                {m.label}
              </button>
            )
          })}
        </div>

        <Field
          label={modo === 'ajuste' ? 'Novo saldo contado' : 'Quantidade'}
          hint={modo === 'ajuste' && produto ? `Saldo atual: ${formatQty(produto.estoque_atual)}` : undefined}
        >
          <NumberInput value={valor} onChange={setValor} decimais={produto?.unidade === 'kg' ? 3 : 0} />
        </Field>

        <Field label="Motivo" hint="opcional (ex.: compra, quebra, contagem)">
          <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
