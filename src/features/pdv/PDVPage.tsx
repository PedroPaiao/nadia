import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Plus, Minus, Trash2, ShoppingCart, Lock, CheckCircle2 } from 'lucide-react'
import { useProducts, useCategories } from '@/features/produtos/api'
import { useCaixaAberto } from '@/features/caixa/api'
import { useRegistrarVenda } from './api'
import type { Product } from '@/types/db'
import { Button, Card, Input, Modal, Badge } from '@/components/ui'
import { PagamentoBox, type PagamentoResultado } from '@/components/PagamentoBox'
import { useToast } from '@/components/toast'
import { formatBRL, formatQty, cn } from '@/lib/utils'

interface CartItem {
  product: Product
  quantidade: number
}

export function PDVPage() {
  const toast = useToast()
  const { data: produtos } = useProducts()
  const { data: categorias } = useCategories()
  const { data: caixa } = useCaixaAberto()
  const registrar = useRegistrarVenda()

  const [busca, setBusca] = useState('')
  const [catFiltro, setCatFiltro] = useState<string>('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [cliente, setCliente] = useState('')
  const [trocoModal, setTrocoModal] = useState<number | null>(null)
  const [resetSignal, setResetSignal] = useState(0)

  const caixaAberto = !!caixa

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (produtos ?? []).filter(
      (p) => (!catFiltro || p.categoria_id === catFiltro) && (!termo || p.nome.toLowerCase().includes(termo)),
    )
  }, [produtos, busca, catFiltro])

  const subtotal = cart.reduce((acc, i) => acc + i.product.preco_venda * i.quantidade, 0)

  function addProduct(p: Product) {
    setCart((prev) => {
      const ex = prev.find((i) => i.product.id === p.id)
      if (ex) return prev.map((i) => (i.product.id === p.id ? { ...i, quantidade: i.quantidade + 1 } : i))
      return [...prev, { product: p, quantidade: 1 }]
    })
  }
  function setQty(id: string, q: number) {
    setCart((prev) =>
      q <= 0 ? prev.filter((i) => i.product.id !== id) : prev.map((i) => (i.product.id === id ? { ...i, quantidade: q } : i)),
    )
  }
  function limpar() {
    setCart([])
    setCliente('')
    setResetSignal((s) => s + 1)
  }

  async function finalizar({ forma, desconto, valor_recebido }: PagamentoResultado) {
    if (!caixaAberto) return toast.error('Abra o caixa antes de vender.')
    if (cart.length === 0) return toast.error('Adicione itens à venda.')
    if (desconto > subtotal) return toast.error('Desconto maior que o total.')

    try {
      const venda = await registrar.mutateAsync({
        items: cart.map((i) => ({ product_id: i.product.id, quantidade: i.quantidade })),
        forma_pagamento: forma,
        desconto,
        cliente_nome: cliente.trim() || undefined,
        valor_recebido,
      })
      const t = venda.troco ?? 0
      limpar()
      if (t > 0) setTrocoModal(t)
      else toast.success('Venda registrada!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao registrar venda.')
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      {/* Catálogo */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto…" className="pl-9" />
        </div>

        <div className="flex flex-wrap gap-2">
          <Chip active={!catFiltro} onClick={() => setCatFiltro('')}>Todos</Chip>
          {categorias?.map((c) => (
            <Chip key={c.id} active={catFiltro === c.id} onClick={() => setCatFiltro(c.id)}>{c.nome}</Chip>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {filtrados.map((p) => (
            <button
              key={p.id}
              onClick={() => addProduct(p)}
              className="flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-brand-300 hover:shadow"
            >
              <span className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold text-slate-800">{p.nome}</span>
              <span className="mt-1 text-base font-bold text-brand-600">{formatBRL(p.preco_venda)}</span>
              {p.controla_estoque && p.estoque_atual <= p.estoque_minimo && (
                <span className="mt-1 text-[11px] font-medium text-red-500">estoque baixo</span>
              )}
            </button>
          ))}
          {filtrados.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-slate-400">Nenhum produto encontrado.</p>
          )}
        </div>
      </div>

      {/* Carrinho */}
      <Card className="flex h-fit flex-col lg:sticky lg:top-4">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <ShoppingCart className="h-5 w-5 text-brand-600" />
          <span className="font-semibold text-slate-900">Venda</span>
          {cart.length > 0 && <Badge tone="brand">{cart.length} item(s)</Badge>}
          {cart.length > 0 && (
            <button onClick={limpar} className="ml-auto text-xs text-slate-400 hover:text-red-500">Limpar</button>
          )}
        </div>

        {!caixaAberto && (
          <div className="m-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              O caixa está fechado.{' '}
              <Link to="/app/caixa" className="font-semibold underline">Abrir caixa</Link> para começar a vender.
            </span>
          </div>
        )}

        <div className="max-h-[40vh] divide-y divide-slate-100 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">Toque nos produtos para adicionar.</p>
          ) : (
            cart.map((i) => (
              <div key={i.product.id} className="flex items-center gap-2 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{i.product.nome}</p>
                  <p className="text-xs text-slate-500">{formatBRL(i.product.preco_venda)} un</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setQty(i.product.id, i.quantidade - 1)} className="rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200">
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-8 text-center text-sm font-semibold tabular">{formatQty(i.quantidade)}</span>
                  <button onClick={() => setQty(i.product.id, i.quantidade + 1)} className="rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <span className="w-20 text-right text-sm font-semibold tabular">{formatBRL(i.product.preco_venda * i.quantidade)}</span>
                <button onClick={() => setQty(i.product.id, 0)} className="text-slate-300 hover:text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Checkout */}
        <div className="space-y-3 border-t border-slate-100 p-4">
          <Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Cliente (opcional)" className="h-10" />
          <PagamentoBox
            key={resetSignal}
            subtotal={subtotal}
            confirmLabel="Finalizar venda"
            disabled={!caixaAberto || cart.length === 0}
            loading={registrar.isPending}
            onConfirm={finalizar}
          />
        </div>
      </Card>

      <Modal open={trocoModal != null} onClose={() => setTrocoModal(null)} title="Venda registrada!" size="sm">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="h-14 w-14 text-emerald-500" />
          <p className="text-slate-600">Troco a devolver:</p>
          <p className="text-4xl font-bold text-slate-900 tabular">{formatBRL(trocoModal ?? 0)}</p>
          <Button className="mt-2 w-full" onClick={() => setTrocoModal(null)}>OK</Button>
        </div>
      </Modal>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1.5 text-sm font-medium transition',
        active ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100',
      )}
    >
      {children}
    </button>
  )
}
