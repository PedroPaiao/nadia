import { useMemo, useState } from 'react'
import { Plus, Pencil, Search, Tags, AlertTriangle } from 'lucide-react'
import {
  useProducts,
  useCategories,
  useCreateProduct,
  useUpdateProduct,
  type ProductInput,
} from './api'
import { CategoriasModal } from './CategoriasModal'
import type { Product, ProductUnit } from '@/types/db'
import { UNIT_LABELS } from '@/types/db'
import { Button, Card, CenterSpinner, EmptyState, Input, Field, Select, Badge, Modal, MoneyInput, NumberInput } from '@/components/ui'
import { useToast } from '@/components/toast'
import { formatBRL, formatQty, unidadeLabel } from '@/lib/utils'

export function ProdutosPage() {
  const [busca, setBusca] = useState('')
  const [incluirInativos, setIncluirInativos] = useState(false)
  const [editando, setEditando] = useState<Product | null>(null)
  const [criando, setCriando] = useState(false)
  const [catOpen, setCatOpen] = useState(false)

  const { data: produtos, isLoading } = useProducts({ includeInactive: incluirInativos })
  const { data: categorias } = useCategories()

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return produtos ?? []
    return (produtos ?? []).filter((p) => p.nome.toLowerCase().includes(termo))
  }, [produtos, busca])

  const catNome = (id: string | null) => categorias?.find((c) => c.id === id)?.nome ?? '—'

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Produtos</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCatOpen(true)}>
            <Tags className="h-4 w-4" /> Categorias
          </Button>
          <Button onClick={() => setCriando(true)}>
            <Plus className="h-4 w-4" /> Novo produto
          </Button>
        </div>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar produto…"
              className="pl-9"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={incluirInativos}
              onChange={(e) => setIncluirInativos(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Mostrar inativos
          </label>
        </div>
      </Card>

      {isLoading ? (
        <CenterSpinner label="Carregando produtos…" />
      ) : filtrados.length === 0 ? (
        <Card>
          <EmptyState title="Nenhum produto" description="Cadastre o primeiro produto para começar a vender." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3 text-right">Preço</th>
                  <th className="px-4 py-3 text-right">Estoque</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtrados.map((p) => {
                  const baixo = p.controla_estoque && p.estoque_atual <= p.estoque_minimo
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{p.nome}</p>
                        <p className="text-xs text-slate-500">por {unidadeLabel(p.unidade)}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{catNome(p.categoria_id)}</td>
                      <td className="px-4 py-3 text-right font-medium tabular">{formatBRL(p.preco_venda)}</td>
                      <td className="px-4 py-3 text-right">
                        {p.controla_estoque ? (
                          <span className={baixo ? 'inline-flex items-center gap-1 font-semibold text-red-600' : 'tabular'}>
                            {baixo && <AlertTriangle className="h-3.5 w-3.5" />}
                            {formatQty(p.estoque_atual)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">não controla</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.ativo ? <Badge tone="green">Ativo</Badge> : <Badge tone="gray">Inativo</Badge>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setEditando(p)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(criando || editando) && (
        <ProdutoFormModal produto={editando} onClose={() => { setCriando(false); setEditando(null) }} />
      )}
      <CategoriasModal open={catOpen} onClose={() => setCatOpen(false)} />
    </div>
  )
}

const UNIDADES: ProductUnit[] = ['un', 'cento', 'kg']

function ProdutoFormModal({ produto, onClose }: { produto: Product | null; onClose: () => void }) {
  const editing = !!produto
  const toast = useToast()
  const { data: categorias } = useCategories()
  const create = useCreateProduct()
  const update = useUpdateProduct()

  const [nome, setNome] = useState(produto?.nome ?? '')
  const [categoriaId, setCategoriaId] = useState<string>(produto?.categoria_id ?? '')
  const [preco, setPreco] = useState(produto?.preco_venda ?? 0)
  const [custo, setCusto] = useState(produto?.custo ?? 0)
  const [unidade, setUnidade] = useState<ProductUnit>(produto?.unidade ?? 'un')
  const [controla, setControla] = useState(produto?.controla_estoque ?? true)
  const [minimo, setMinimo] = useState(produto?.estoque_minimo ?? 0)
  const [ativo, setAtivo] = useState(produto?.ativo ?? true)
  const [estoqueInicial, setEstoqueInicial] = useState(0)

  const saving = create.isPending || update.isPending

  async function salvar() {
    if (!nome.trim()) {
      toast.error('Informe o nome do produto.')
      return
    }
    if (!(Number(preco) > 0)) {
      toast.error('Informe um preço de venda maior que zero.')
      return
    }
    const input: ProductInput = {
      nome: nome.trim(),
      categoria_id: categoriaId || null,
      preco_venda: Number(preco) || 0,
      custo: Number(custo) || null,
      unidade,
      controla_estoque: controla,
      estoque_minimo: Number(minimo) || 0,
      ativo,
    }
    try {
      if (editing && produto) {
        await update.mutateAsync({ id: produto.id, input })
        toast.success('Produto atualizado.')
      } else {
        await create.mutateAsync({ ...input, estoque_inicial: controla ? Number(estoqueInicial) || 0 : 0 })
        toast.success('Produto criado.')
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar.')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Editar produto' : 'Novo produto'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} loading={saving}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} autoFocus />
        </Field>
        <Field label="Categoria">
          <Select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">Sem categoria</option>
            {categorias?.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preço de venda">
            <MoneyInput value={preco} onChange={setPreco} />
          </Field>
          <Field label="Custo" hint="opcional">
            <MoneyInput value={custo} onChange={setCusto} />
          </Field>
        </div>
        <Field label="Unidade de venda">
          <Select value={unidade} onChange={(e) => setUnidade(e.target.value as ProductUnit)}>
            {UNIDADES.map((u) => (
              <option key={u} value={u}>{UNIT_LABELS[u]}</option>
            ))}
          </Select>
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={controla} onChange={(e) => setControla(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Controlar estoque deste produto
        </label>

        {controla && (
          <div className="grid grid-cols-2 gap-3">
            {!editing && (
              <Field label="Estoque inicial">
                <NumberInput value={estoqueInicial} onChange={setEstoqueInicial} decimais={unidade === 'kg' ? 3 : 0} />
              </Field>
            )}
            <Field label="Estoque mínimo" hint="alerta abaixo disso">
              <NumberInput value={minimo} onChange={setMinimo} decimais={unidade === 'kg' ? 3 : 0} />
            </Field>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Produto ativo (aparece no PDV)
        </label>
      </div>
    </Modal>
  )
}
