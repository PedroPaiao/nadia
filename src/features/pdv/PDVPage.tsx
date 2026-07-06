import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Plus, Minus, Trash2, ShoppingCart, Lock, CheckCircle2, Flame, X, Pencil } from 'lucide-react'
import { useProducts, useCategories } from '@/features/produtos/api'
import { useCaixaAberto } from '@/features/caixa/api'
import { useRegistrarVenda, useMaisVendidos } from './api'
import type { Product } from '@/types/db'
import { Button, Card, Input, Modal, Badge, NumberInput } from '@/components/ui'
import { PagamentoBox, type PagamentoResultado } from '@/components/PagamentoBox'
import { useToast } from '@/components/toast'
import { formatBRL, formatQty, unidadeLabel, cn } from '@/lib/utils'

interface CartItem {
  product: Product
  quantidade: number
}

// Detecta um multiplicador na busca: "3 coxinha", "3x coxinha", "2,5 kg queijo".
function parseQtdPrefixo(texto: string): { qtd: number; resto: string } | null {
  const m = texto.match(/^\s*(\d+(?:[.,]\d+)?)\s*[x*]?\s+(.+)$/)
  if (!m) return null
  const qtd = parseFloat(m[1].replace(',', '.'))
  if (!qtd || qtd <= 0) return null
  return { qtd, resto: m[2].trim() }
}

export function PDVPage() {
  const toast = useToast()
  const { data: produtos } = useProducts()
  const { data: categorias } = useCategories()
  const { data: caixa } = useCaixaAberto()
  const { data: maisVendidosRaw } = useMaisVendidos(8, 120)
  const registrar = useRegistrarVenda()

  const [busca, setBusca] = useState('')
  const [catFiltro, setCatFiltro] = useState<string>('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [cliente, setCliente] = useState('')
  const [trocoModal, setTrocoModal] = useState<number | null>(null)
  const [resetSignal, setResetSignal] = useState(0)
  const [sheetAberto, setSheetAberto] = useState(false)
  const [editarQtd, setEditarQtd] = useState<string | null>(null)
  const [confirmLimpar, setConfirmLimpar] = useState(false)

  const caixaAberto = !!caixa

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (produtos ?? []).filter(
      (p) => p.ativo && (!catFiltro || p.categoria_id === catFiltro) && (!termo || p.nome.toLowerCase().includes(termo)),
    )
  }, [produtos, busca, catFiltro])

  // Mapeia os campeões de venda para os produtos ativos do catálogo.
  const maisVendidos = useMemo(() => {
    const byId = new Map((produtos ?? []).map((p) => [p.id, p]))
    return (maisVendidosRaw ?? [])
      .map((m) => byId.get(m.product_id))
      .filter((p): p is Product => !!p && p.ativo)
      .slice(0, 8)
  }, [maisVendidosRaw, produtos])

  const cor = useMemo(() => corDeCategoria(categorias?.map((c) => c.id) ?? []), [categorias])

  const subtotal = cart.reduce((acc, i) => acc + i.product.preco_venda * i.quantidade, 0)
  const totalItens = cart.reduce((acc, i) => acc + i.quantidade, 0)

  function addProduct(p: Product, qtd = 1) {
    setCart((prev) => {
      const ex = prev.find((i) => i.product.id === p.id)
      if (ex) return prev.map((i) => (i.product.id === p.id ? { ...i, quantidade: i.quantidade + qtd } : i))
      return [...prev, { product: p, quantidade: qtd }]
    })
    toast.success(`+${formatQty(qtd)} ${p.nome}`)
  }
  function setQty(id: string, q: number) {
    setCart((prev) =>
      q <= 0 ? prev.filter((i) => i.product.id !== id) : prev.map((i) => (i.product.id === id ? { ...i, quantidade: q } : i)),
    )
  }
  function removerItem(item: CartItem) {
    setCart((prev) => prev.filter((i) => i.product.id !== item.product.id))
    toast.info(`${item.product.nome} removido`)
  }
  function limpar() {
    setCart([])
    setCliente('')
    setConfirmLimpar(false)
    setResetSignal((s) => s + 1)
  }

  function onBuscaEnter() {
    const pref = parseQtdPrefixo(busca)
    const termo = (pref?.resto ?? busca).trim().toLowerCase()
    const alvo = (produtos ?? []).find((p) => p.ativo && p.nome.toLowerCase().includes(termo))
    if (!termo || !alvo) return
    addProduct(alvo, pref?.qtd ?? 1)
    setBusca('')
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
      setSheetAberto(false)
      if (t > 0) setTrocoModal(t)
      else toast.success('Venda registrada!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao registrar venda.')
    }
  }

  const itemEmEdicao = cart.find((i) => i.product.id === editarQtd) ?? null

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_390px] lg:gap-4">
      {/* ---------------- Catálogo ---------------- */}
      <div className="space-y-3 pb-28 lg:pb-0">
        {!caixaAberto && (
          <Link to="/app/caixa" className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800 lg:hidden">
            <Lock className="h-4 w-4 shrink-0" /> Caixa fechado — toque para abrir e vender.
          </Link>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onBuscaEnter()}
            placeholder="Buscar produto…  (dica: “3 coxinha” já adiciona 3)"
            className="h-12 pl-9 text-base"
            autoFocus
          />
        </div>

        {/* Mais vendidos — atalho de 1 toque (some quando está buscando) */}
        {!busca.trim() && maisVendidos.length > 0 && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Flame className="h-3.5 w-3.5 text-orange-500" /> Mais vendidos
            </p>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {maisVendidos.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  className="flex min-h-[3rem] shrink-0 items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-left text-sm font-semibold text-slate-800 transition active:scale-[0.97]"
                >
                  <span className="max-w-[9rem] truncate">{p.nome}</span>
                  <span className="whitespace-nowrap font-bold text-brand-600">{formatBRL(p.preco_venda)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Chip active={!catFiltro} onClick={() => setCatFiltro('')}>Todos</Chip>
          {categorias?.map((c) => (
            <Chip key={c.id} active={catFiltro === c.id} onClick={() => setCatFiltro(c.id)}>{c.nome}</Chip>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {filtrados.map((p) => (
            <ProdutoTile key={p.id} produto={p} cor={cor(p.categoria_id)} onAdd={() => addProduct(p)} />
          ))}
          {filtrados.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-slate-400">Nenhum produto encontrado.</p>
          )}
        </div>
      </div>

      {/* ---------------- Carrinho — coluna fixa (desktop) ---------------- */}
      <Card className="hidden h-[calc(100vh-2rem)] flex-col lg:sticky lg:top-4 lg:flex">
        <CartHeader itens={totalItens} onLimpar={() => setConfirmLimpar(true)} />
        {!caixaAberto && <CaixaFechadoAviso />}
        <CartLista
          cart={cart}
          onDec={(i) => setQty(i.product.id, i.quantidade - 1)}
          onInc={(i) => setQty(i.product.id, i.quantidade + 1)}
          onEditar={(i) => setEditarQtd(i.product.id)}
          onRemover={removerItem}
        />
        <CheckoutFooter
          resetSignal={resetSignal}
          cliente={cliente}
          setCliente={setCliente}
          subtotal={subtotal}
          disabled={!caixaAberto || cart.length === 0}
          loading={registrar.isPending}
          onConfirm={finalizar}
        />
      </Card>

      {/* ---------------- Barra de carrinho fixa (mobile/tablet) ---------------- */}
      {cart.length > 0 && (
        <button
          onClick={() => setSheetAberto(true)}
          className="fixed inset-x-0 bottom-16 z-30 mx-auto flex max-w-3xl items-center gap-3 border-t border-brand-700 bg-brand-600 px-4 py-3 text-white shadow-lg md:bottom-0 lg:hidden"
        >
          <span className="relative">
            <ShoppingCart className="h-6 w-6" />
            <span className="absolute -right-2 -top-2 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-white px-1 text-xs font-bold text-brand-700">
              {formatQty(totalItens)}
            </span>
          </span>
          <span className="text-sm font-medium opacity-90">Ver venda</span>
          <span className="ml-auto text-lg font-bold tabular">{formatBRL(subtotal)}</span>
          <span className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-bold">Cobrar ›</span>
        </button>
      )}

      {/* ---------------- Sheet do carrinho (mobile) ---------------- */}
      {sheetAberto && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 lg:hidden" onClick={() => setSheetAberto(false)}>
          <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <ShoppingCart className="h-5 w-5 text-brand-600" />
              <span className="font-semibold text-slate-900">Venda</span>
              <Badge tone="brand">{formatQty(totalItens)} item(s)</Badge>
              <button onClick={() => setConfirmLimpar(true)} className="ml-auto text-xs text-slate-400 hover:text-red-500">Limpar</button>
              <button onClick={() => setSheetAberto(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            {!caixaAberto && <CaixaFechadoAviso />}
            <CartLista
              cart={cart}
              onDec={(i) => setQty(i.product.id, i.quantidade - 1)}
              onInc={(i) => setQty(i.product.id, i.quantidade + 1)}
              onEditar={(i) => setEditarQtd(i.product.id)}
              onRemover={removerItem}
            />
            <CheckoutFooter
              resetSignal={resetSignal}
              cliente={cliente}
              setCliente={setCliente}
              subtotal={subtotal}
              disabled={!caixaAberto || cart.length === 0}
              loading={registrar.isPending}
              onConfirm={finalizar}
            />
          </div>
        </div>
      )}

      {/* Editor de quantidade (cento/kg/lote) */}
      {itemEmEdicao && (
        <QtdModal
          item={itemEmEdicao}
          onClose={() => setEditarQtd(null)}
          onConfirm={(q) => { setQty(itemEmEdicao.product.id, q); setEditarQtd(null) }}
        />
      )}

      {/* Confirmar limpar carrinho */}
      <Modal
        open={confirmLimpar}
        onClose={() => setConfirmLimpar(false)}
        title="Limpar a venda?"
        size="sm"
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmLimpar(false)}>Voltar</Button>
          <Button variant="danger" onClick={limpar}>Limpar {formatQty(totalItens)} item(s)</Button>
        </>}
      >
        <p className="text-sm text-slate-600">Isso remove todos os itens do carrinho ({formatBRL(subtotal)}).</p>
      </Modal>

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

// ---------------- Subcomponentes ----------------

function ProdutoTile({ produto: p, cor, onAdd }: { produto: Product; cor: string; onAdd: () => void }) {
  const semEstoque = p.controla_estoque && p.estoque_atual <= 0
  const estoqueBaixo = p.controla_estoque && p.estoque_atual > 0 && p.estoque_atual <= p.estoque_minimo
  return (
    <button
      onClick={onAdd}
      className="flex min-h-[4.75rem] flex-col justify-between gap-1 overflow-hidden rounded-xl border border-slate-200 bg-white p-2.5 text-left shadow-sm transition hover:border-brand-300 hover:shadow active:scale-[0.98]"
    >
      <span className="flex items-start gap-1.5">
        <span className={cn('mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full', cor)} />
        <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-slate-800">{p.nome}</span>
      </span>
      <span className="flex items-end justify-between gap-1">
        <span className="text-sm font-bold text-brand-600">
          {formatBRL(p.preco_venda)}
          {p.unidade !== 'un' && <span className="text-[11px] font-medium text-slate-400">/{unidadeLabel(p.unidade)}</span>}
        </span>
        {semEstoque ? (
          <span className="rounded bg-red-100 px-1 text-[10px] font-semibold text-red-600">esgotado</span>
        ) : estoqueBaixo ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" title="estoque baixo" />
        ) : null}
      </span>
    </button>
  )
}

function CartHeader({ itens, onLimpar }: { itens: number; onLimpar: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
      <ShoppingCart className="h-5 w-5 text-brand-600" />
      <span className="font-semibold text-slate-900">Venda</span>
      {itens > 0 && <Badge tone="brand">{formatQty(itens)} item(s)</Badge>}
      {itens > 0 && <button onClick={onLimpar} className="ml-auto text-xs text-slate-400 hover:text-red-500">Limpar</button>}
    </div>
  )
}

function CaixaFechadoAviso() {
  return (
    <div className="m-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" />
      <span>O caixa está fechado.{' '}
        <Link to="/app/caixa" className="font-semibold underline">Abrir caixa</Link> para começar a vender.</span>
    </div>
  )
}

function CartLista({
  cart, onDec, onInc, onEditar, onRemover,
}: {
  cart: CartItem[]
  onDec: (i: CartItem) => void
  onInc: (i: CartItem) => void
  onEditar: (i: CartItem) => void
  onRemover: (i: CartItem) => void
}) {
  if (cart.length === 0) {
    return <p className="flex-1 px-4 py-10 text-center text-sm text-slate-400">Toque nos produtos para adicionar.</p>
  }
  return (
    <div className="flex-1 divide-y divide-slate-100 overflow-y-auto">
      {cart.map((i) => (
        <div key={i.product.id} className="flex items-center gap-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">{i.product.nome}</p>
            <p className="text-xs text-slate-500">{formatBRL(i.product.preco_venda)}/{unidadeLabel(i.product.unidade)}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => onDec(i)} className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-95">
              <Minus className="h-4 w-4" />
            </button>
            <button
              onClick={() => onEditar(i)}
              className="flex h-11 min-w-[3rem] items-center justify-center gap-1 rounded-lg px-1 text-base font-semibold tabular text-slate-800 hover:bg-slate-100"
              title="Digitar quantidade"
            >
              {formatQty(i.quantidade)}
              <Pencil className="h-3 w-3 text-slate-400" />
            </button>
            <button onClick={() => onInc(i)} className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-95">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <span className="w-[4.5rem] text-right text-sm font-bold tabular text-slate-900">{formatBRL(i.product.preco_venda * i.quantidade)}</span>
          <button onClick={() => onRemover(i)} className="flex h-11 w-8 items-center justify-center text-slate-300 hover:text-red-500">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}

function CheckoutFooter({
  resetSignal, cliente, setCliente, subtotal, disabled, loading, onConfirm,
}: {
  resetSignal: number
  cliente: string
  setCliente: (v: string) => void
  subtotal: number
  disabled: boolean
  loading: boolean
  onConfirm: (r: PagamentoResultado) => void
}) {
  return (
    <div className="space-y-3 border-t border-slate-100 p-4">
      <Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Cliente (opcional)" className="h-10" />
      <PagamentoBox
        key={resetSignal}
        subtotal={subtotal}
        confirmLabel="Finalizar venda"
        disabled={disabled}
        loading={loading}
        onConfirm={onConfirm}
      />
    </div>
  )
}

function QtdModal({ item, onClose, onConfirm }: { item: CartItem; onClose: () => void; onConfirm: (q: number) => void }) {
  const { product: p } = item
  const [q, setQ] = useState(item.quantidade)
  const kg = p.unidade === 'kg'
  const atalhos = kg ? [0.25, 0.5, 1, 2] : p.unidade === 'cento' ? [1, 2, 3, 5, 10] : [5, 10, 25, 50, 100]
  return (
    <Modal
      open onClose={onClose} size="sm" title={<span className="truncate">{p.nome}</span>}
      onSubmit={() => onConfirm(q)}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => onConfirm(q)}>Aplicar ({formatQty(q)} {unidadeLabel(p.unidade)})</Button>
      </>}
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-500">Quantidade em <span className="font-semibold text-slate-700">{unidadeLabel(p.unidade)}</span> · {formatBRL(p.preco_venda)}/{unidadeLabel(p.unidade)}</p>
        <NumberInput value={q} onChange={setQ} decimais={kg ? 3 : 0} min={0} autoFocus />
        <div className="flex flex-wrap gap-2">
          {atalhos.map((v) => (
            <button key={v} onClick={() => setQ(v)} className="rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200">
              {formatQty(v)}
            </button>
          ))}
        </div>
        <div className="flex justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">Subtotal</span>
          <span className="font-bold tabular text-slate-900">{formatBRL(p.preco_venda * q)}</span>
        </div>
      </div>
    </Modal>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'min-h-[2.5rem] rounded-full px-4 text-sm font-medium transition',
        active ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100',
      )}
    >
      {children}
    </button>
  )
}

// Cor estável por categoria (reconhecimento visual rápido na grade).
const PALETA = ['bg-rose-400', 'bg-amber-400', 'bg-emerald-400', 'bg-sky-400', 'bg-violet-400', 'bg-orange-400', 'bg-teal-400', 'bg-pink-400']
function corDeCategoria(ids: string[]) {
  const idx = new Map(ids.map((id, i) => [id, i]))
  return (categoriaId: string | null) => {
    if (!categoriaId) return 'bg-slate-300'
    return PALETA[(idx.get(categoriaId) ?? 0) % PALETA.length]
  }
}
