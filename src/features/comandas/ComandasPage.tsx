import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, Utensils, Trash2, Receipt, XCircle, Clock, Lock, CheckCircle2, ArrowLeft,
} from 'lucide-react'
import {
  useComandasAbertas, useAbrirComanda, useAdicionarItem, useRemoverItem,
  useFecharComanda, useCancelarComanda, type ComandaComItens,
} from './api'
import { useProducts } from '@/features/produtos/api'
import { useCaixaAberto } from '@/features/caixa/api'
import { Button, Card, CenterSpinner, EmptyState, Input, Field, Modal, Badge, NumberInput } from '@/components/ui'
import { Combobox } from '@/components/Combobox'
import { PagamentoBox, type PagamentoResultado } from '@/components/PagamentoBox'
import { useToast } from '@/components/toast'
import { formatBRL, formatQty } from '@/lib/utils'

function totalComanda(c: ComandaComItens): number {
  return c.comanda_items.reduce((a, i) => a + Number(i.subtotal), 0)
}

export function ComandasPage() {
  const toast = useToast()
  const { data: comandas, isLoading } = useComandasAbertas()
  const [nova, setNova] = useState(false)
  const [aberta, setAberta] = useState<string | null>(null)
  const [troco, setTroco] = useState<number | null>(null)

  const comandaAberta = comandas?.find((c) => c.id === aberta) ?? null

  function aoPagar(t: number) {
    setAberta(null)
    if (t > 0) setTroco(t)
    else toast.success('Comanda paga!')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Comandas / Mesas</h1>
        <Button onClick={() => setNova(true)}>
          <Plus className="h-4 w-4" /> Nova comanda
        </Button>
      </div>

      {isLoading ? (
        <CenterSpinner />
      ) : !comandas || comandas.length === 0 ? (
        <Card><EmptyState title="Nenhuma comanda aberta" description="Abra uma comanda para lançar itens que serão pagos no final." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {comandas.map((c) => (
            <button
              key={c.id}
              onClick={() => setAberta(c.id)}
              className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-300 hover:shadow"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-slate-900">
                  <Utensils className="h-4 w-4 text-brand-500" /> {c.nome}
                </span>
                <Badge tone="amber">{c.comanda_items.length} item(s)</Badge>
              </div>
              <span className="mt-3 text-2xl font-bold tabular text-slate-900">{formatBRL(totalComanda(c))}</span>
              <span className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400">
                <Clock className="h-3.5 w-3.5" />
                {new Date(c.aberta_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </button>
          ))}
        </div>
      )}

      {nova && <NovaComandaModal onClose={() => setNova(false)} onCreated={(id) => { setNova(false); setAberta(id) }} />}
      {comandaAberta && <ComandaModal comanda={comandaAberta} onClose={() => setAberta(null)} onPaid={aoPagar} />}

      <Modal open={troco != null} onClose={() => setTroco(null)} title="Comanda paga!" size="sm">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="h-14 w-14 text-emerald-500" />
          <p className="text-slate-600">Troco a devolver:</p>
          <p className="text-4xl font-bold tabular text-slate-900">{formatBRL(troco ?? 0)}</p>
          <Button className="mt-2 w-full" onClick={() => setTroco(null)}>OK</Button>
        </div>
      </Modal>
    </div>
  )
}

function NovaComandaModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast()
  const abrir = useAbrirComanda()
  const [nome, setNome] = useState('')

  async function salvar() {
    if (!nome.trim()) return toast.error('Dê um nome à comanda (mesa ou cliente).')
    try {
      const c = await abrir.mutateAsync(nome.trim())
      onCreated(c.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.')
    }
  }

  return (
    <Modal
      open onClose={onClose} title="Nova comanda" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={salvar} loading={abrir.isPending}>Abrir</Button></>}
    >
      <Field label="Nome" hint="mesa ou cliente — ex.: Mesa 3, João, Guarda-sol 2">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} autoFocus onKeyDown={(e) => e.key === 'Enter' && salvar()} />
      </Field>
    </Modal>
  )
}

function ComandaModal({ comanda, onClose, onPaid }: { comanda: ComandaComItens; onClose: () => void; onPaid: (troco: number) => void }) {
  const toast = useToast()
  const { data: produtos } = useProducts()
  const { data: caixa } = useCaixaAberto()
  const adicionar = useAdicionarItem()
  const remover = useRemoverItem()
  const fechar = useFecharComanda()
  const cancelar = useCancelarComanda()

  const [modo, setModo] = useState<'itens' | 'pagar'>('itens')
  const [qtdAdd, setQtdAdd] = useState(1)

  const total = totalComanda(comanda)
  const itemOptions = useMemo(
    () => (produtos ?? []).map((p) => ({ value: p.id, label: p.nome, hint: formatBRL(p.preco_venda) })),
    [produtos],
  )

  async function add(productId: string) {
    const q = qtdAdd > 0 ? qtdAdd : 1
    try {
      await adicionar.mutateAsync({ comanda_id: comanda.id, product_id: productId, quantidade: q })
      setQtdAdd(1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao adicionar.')
    }
  }
  async function rm(itemId: string) {
    try {
      await remover.mutateAsync(itemId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover.')
    }
  }
  async function cancelarComanda() {
    if (!confirm('Cancelar esta comanda? Os itens serão estornados do estoque.')) return
    try {
      await cancelar.mutateAsync(comanda.id)
      toast.success('Comanda cancelada.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.')
    }
  }

  async function receber({ forma, desconto, valor_recebido }: PagamentoResultado) {
    if (!caixa) return toast.error('Abra o caixa para receber.')
    if (desconto > total) return toast.error('Desconto maior que o total.')
    try {
      const venda = await fechar.mutateAsync({ comanda_id: comanda.id, forma_pagamento: forma, desconto, valor_recebido })
      onPaid(venda.troco ?? 0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao fechar.')
    }
  }

  return (
    <Modal
      open onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {modo === 'pagar' && (
            <button onClick={() => setModo('itens')} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /></button>
          )}
          {comanda.nome}
        </span>
      }
    >
      {modo === 'itens' ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="w-20 shrink-0">
              <NumberInput value={qtdAdd} onChange={setQtdAdd} decimais={3} />
            </div>
            <div className="flex-1">
              <Combobox items={itemOptions} onSelect={(id) => add(id)} clearOnSelect placeholder="Buscar item (qtd ao lado)…" />
            </div>
          </div>

          {comanda.comanda_items.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Nenhum item lançado ainda.</p>
          ) : (
            <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {comanda.comanda_items.map((it) => (
                <div key={it.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-slate-700">
                    {formatQty(it.quantidade)}× {it.product_nome}
                  </span>
                  <span className="font-semibold tabular text-slate-900">{formatBRL(it.subtotal)}</span>
                  <button onClick={() => rm(it.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-500">Total da comanda</span>
            <span className="text-xl font-bold tabular text-slate-900">{formatBRL(total)}</span>
          </div>

          <div className="flex gap-2">
            <Button variant="danger" onClick={cancelarComanda} loading={cancelar.isPending}>
              <XCircle className="h-4 w-4" /> Cancelar
            </Button>
            <Button className="flex-1" onClick={() => setModo('pagar')} disabled={comanda.comanda_items.length === 0}>
              <Receipt className="h-4 w-4" /> Fechar conta ({formatBRL(total)})
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {!caixa && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <span>O caixa está fechado. <Link to="/app/caixa" className="font-semibold underline">Abrir caixa</Link> para receber.</span>
            </div>
          )}
          <PagamentoBox
            subtotal={total}
            confirmLabel="Receber e fechar"
            disabled={!caixa}
            loading={fechar.isPending}
            onConfirm={receber}
          />
        </div>
      )}
    </Modal>
  )
}
