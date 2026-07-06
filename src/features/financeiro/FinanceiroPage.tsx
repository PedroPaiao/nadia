import { useState } from 'react'
import {
  Wallet, Scale, TrendingDown, Plus, Pencil, Trash2, CheckCircle2,
  AlertTriangle, CalendarClock, Landmark, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import {
  useContas, useSalvarConta, useExcluirConta,
  useDespesas, useTotalAPagar, useSalvarDespesa, usePagarDespesa, useExcluirDespesa,
  useFinanceiroPeriodo, type DespesaInput,
} from './api'
import { useContasReceber } from '@/features/encomendas/api'
import type { Conta, Despesa, ExpenseCategory, ExpenseStatus, OrderPaymentMethod } from '@/types/db'
import { EXPENSE_CATEGORY_LABELS, ORDER_PAYMENT_LABELS } from '@/types/db'
import { Button, Card, CardHeader, CenterSpinner, EmptyState, Field, Input, Select, Textarea, Modal, Badge, MoneyInput } from '@/components/ui'
import { DatePicker } from '@/components/DateTimePicker'
import { useToast } from '@/components/toast'
import {
  formatBRL, formatDataBR, hojeData, hojeMaisDias, primeiroDiaDoMes, ultimoDiaDoMes,
  inicioDoDiaISO, fimDoDiaExclusivoISO, cn,
} from '@/lib/utils'

type Aba = 'balanco' | 'pagar' | 'contas'

export function FinanceiroPage() {
  const [aba, setAba] = useState<Aba>('balanco')
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Financeiro</h1>
      <div className="flex flex-wrap gap-2">
        <Tab active={aba === 'balanco'} onClick={() => setAba('balanco')} icon={<Scale className="h-4 w-4" />}>Balanço</Tab>
        <Tab active={aba === 'pagar'} onClick={() => setAba('pagar')} icon={<TrendingDown className="h-4 w-4" />}>Contas a pagar</Tab>
        <Tab active={aba === 'contas'} onClick={() => setAba('contas')} icon={<Landmark className="h-4 w-4" />}>Minhas contas</Tab>
      </div>
      {aba === 'balanco' && <Balanco />}
      {aba === 'pagar' && <ContasAPagar />}
      {aba === 'contas' && <MinhasContas />}
    </div>
  )
}

// ============================ Balanço ============================
function Balanco() {
  const [de, setDe] = useState(primeiroDiaDoMes(0))
  const [ate, setAte] = useState(hojeData())
  const [d1, d2] = de <= ate ? [de, ate] : [ate, de]
  const inicio = inicioDoDiaISO(d1)
  const fim = fimDoDiaExclusivoISO(d2)

  const { data: contas } = useContas()
  const { data: contasReceber } = useContasReceber()
  const { data: aPagar } = useTotalAPagar()
  const { data: periodo, isLoading } = useFinanceiroPeriodo(inicio, fim)

  const saldoContas = (contas ?? []).reduce((a, c) => a + Number(c.saldo), 0)
  const aReceber = (contasReceber ?? []).reduce((a, c) => a + Number(c.total), 0)
  const aPagarTotal = aPagar?.total ?? 0
  const posicao = saldoContas + aReceber - aPagarTotal

  const entradas = (periodo?.entradas_vendas ?? 0) + (periodo?.entradas_encomendas ?? 0)
  const saidas = periodo?.saidas_despesas ?? 0
  const resultado = entradas - saidas

  const presets = [
    { label: 'Este mês', on: () => { setDe(primeiroDiaDoMes(0)); setAte(hojeData()) } },
    { label: 'Mês passado', on: () => { setDe(primeiroDiaDoMes(-1)); setAte(ultimoDiaDoMes(-1)) } },
    { label: '7 dias', on: () => { setDe(hojeMaisDias(-6)); setAte(hojeData()) } },
    { label: 'Hoje', on: () => { setDe(hojeData()); setAte(hojeData()) } },
  ]

  return (
    <div className="space-y-4">
      {/* Posição atual (x - y) */}
      <Card className={cn('p-5', posicao >= 0 ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white')}>
        <p className={cn('text-sm', posicao >= 0 ? 'text-emerald-100' : 'text-red-100')}>Posição (o que tem + a receber − a pagar)</p>
        <p className="mt-1 text-3xl font-bold tabular">{formatBRL(posicao)}</p>
        <p className="mt-1 text-xs opacity-90">
          {formatBRL(saldoContas)} em contas + {formatBRL(aReceber)} a receber − {formatBRL(aPagarTotal)} a pagar
        </p>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <Metric label="Em contas" value={saldoContas} icon={<Wallet className="h-4 w-4" />} />
        <Metric label="A receber" value={aReceber} icon={<ArrowUpRight className="h-4 w-4" />} tone="emerald" />
        <Metric label="A pagar" value={aPagarTotal} icon={<ArrowDownRight className="h-4 w-4" />} tone="red" />
      </div>

      {/* Período: entrou x saiu */}
      <Card className="p-3">
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button key={p.label} onClick={p.on} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200">
              {p.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <DatePicker value={de} onChange={setDe} clearable={false} className="w-36" />
            <span className="text-slate-400">até</span>
            <DatePicker value={ate} onChange={setAte} clearable={false} className="w-36" />
          </div>
        </div>
      </Card>

      {isLoading ? (
        <CenterSpinner />
      ) : (
        <Card>
          <CardHeader title="Movimento do período" subtitle={`${formatDataBR(d1)} a ${formatDataBR(d2)}`} />
          <div className="space-y-3 p-5">
            <LinhaFin label="Vendas (balcão)" value={periodo?.entradas_vendas ?? 0} entrada />
            <LinhaFin label="Encomendas recebidas" value={periodo?.entradas_encomendas ?? 0} entrada />
            <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-semibold text-emerald-700">
              <span>Total que entrou</span><span className="tabular">{formatBRL(entradas)}</span>
            </div>
            <LinhaFin label="Despesas pagas" value={saidas} entrada={false} />
            <div className={cn('flex items-center justify-between border-t-2 border-slate-200 pt-3 text-lg font-bold', resultado >= 0 ? 'text-emerald-700' : 'text-red-600')}>
              <span>{resultado >= 0 ? 'Sobrou' : 'Faltou'}</span>
              <span className="tabular">{formatBRL(Math.abs(resultado))}</span>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

function Metric({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone?: 'emerald' | 'red' }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs text-slate-500">{icon}{label}</p>
      <p className={cn('mt-1 text-lg font-bold tabular', tone === 'emerald' && 'text-emerald-600', tone === 'red' && 'text-red-600', !tone && 'text-slate-900')}>
        {formatBRL(value)}
      </p>
    </Card>
  )
}

function LinhaFin({ label, value, entrada }: { label: string; value: number; entrada: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className={cn('tabular font-medium', entrada ? 'text-slate-800' : 'text-red-600')}>
        {entrada ? '' : '− '}{formatBRL(value)}
      </span>
    </div>
  )
}

// ============================ Contas a pagar ============================
const CATEGORIAS: ExpenseCategory[] = ['fornecedor', 'funcionario', 'aluguel', 'contas', 'impostos', 'boleto', 'outro']
const catTone: Record<ExpenseCategory, 'blue' | 'brand' | 'amber' | 'gray'> = {
  fornecedor: 'blue', funcionario: 'brand', aluguel: 'amber', contas: 'amber', impostos: 'gray', boleto: 'blue', outro: 'gray',
}
const PAGINA = 30

function ContasAPagar() {
  const [aba, setAba] = useState<ExpenseStatus | 'todas'>('pendente')
  const [limite, setLimite] = useState(PAGINA)
  const [nova, setNova] = useState(false)
  const [editando, setEditando] = useState<Despesa | null>(null)
  const { data, isLoading } = useDespesas(aba === 'todas' ? undefined : aba, limite)
  const { data: aPagar } = useTotalAPagar()

  const despesas = data?.rows ?? []
  const total = data?.total ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
        <Button onClick={() => setNova(true)}><Plus className="h-4 w-4" /> Nova despesa</Button>
      </div>

      {aPagar && aPagar.qtd > 0 && (
        <Card className={cn('border-2', aPagar.vencidos > 0 ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50')}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className={cn('flex items-center gap-2 font-semibold', aPagar.vencidos > 0 ? 'text-red-800' : 'text-amber-800')}>
                <AlertTriangle className="h-5 w-5" /> A pagar
              </p>
              <p className="mt-0.5 text-sm text-slate-600">
                {aPagar.qtd} conta(s) pendente(s)
                {aPagar.vencidos > 0 && <span className="font-semibold text-red-700"> • {aPagar.vencidos} vencida(s)</span>}
              </p>
            </div>
            <p className="text-2xl font-bold tabular text-slate-900">{formatBRL(aPagar.total)}</p>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {(['pendente', 'pago', 'todas'] as const).map((k) => (
          <button
            key={k}
            onClick={() => { setAba(k); setLimite(PAGINA) }}
            className={cn('rounded-full px-4 py-1.5 text-sm font-medium capitalize transition',
              aba === k ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100')}
          >
            {k === 'pendente' ? 'Pendentes' : k === 'pago' ? 'Pagas' : 'Todas'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <CenterSpinner />
      ) : despesas.length === 0 ? (
        <Card><EmptyState title="Nenhuma despesa" description="Lance uma conta a pagar (fornecedor, boleto, funcionário...)." /></Card>
      ) : (
        <div className="space-y-3">
          {despesas.map((d) => <DespesaCard key={d.id} despesa={d} onEditar={() => setEditando(d)} />)}
          {despesas.length < total && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" onClick={() => setLimite((l) => l + PAGINA)}>Carregar mais ({total - despesas.length} restantes)</Button>
            </div>
          )}
        </div>
      )}

      {nova && <DespesaForm onClose={() => setNova(false)} />}
      {editando && <DespesaForm despesa={editando} onClose={() => setEditando(null)} />}
    </div>
  )
}

function DespesaCard({ despesa: d, onEditar }: { despesa: Despesa; onEditar: () => void }) {
  const toast = useToast()
  const excluir = useExcluirDespesa()
  const [pagarOpen, setPagarOpen] = useState(false)
  const vencida = d.status === 'pendente' && d.data_vencimento != null && d.data_vencimento < hojeData()

  async function apagar() {
    if (!confirm(`Excluir a despesa "${d.descricao}"?`)) return
    try { await excluir.mutateAsync(d.id); toast.success('Despesa excluída.') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Erro.') }
  }

  return (
    <Card className={cn(d.status === 'pago' && 'opacity-70')}>
      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{d.descricao}</span>
            <Badge tone={catTone[d.categoria]}>{EXPENSE_CATEGORY_LABELS[d.categoria]}</Badge>
            {d.status === 'pago' ? <Badge tone="green">Paga</Badge> : vencida ? <Badge tone="red">Vencida</Badge> : <Badge tone="amber">Pendente</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {d.beneficiario && <span>{d.beneficiario}</span>}
            {d.data_vencimento && d.status === 'pendente' && (
              <span className={cn('inline-flex items-center gap-1', vencida && 'font-semibold text-red-600')}>
                <CalendarClock className="h-3.5 w-3.5" /> vence {formatDataBR(d.data_vencimento)}
              </span>
            )}
            {d.status === 'pago' && d.data_pagamento && (
              <span>paga em {formatDataBR(d.data_pagamento)}{d.forma_pagamento ? ` • ${ORDER_PAYMENT_LABELS[d.forma_pagamento]}` : ''}</span>
            )}
          </div>
        </div>
        <span className="shrink-0 text-lg font-bold tabular text-slate-900">{formatBRL(d.valor)}</span>
        <div className="flex shrink-0 gap-1">
          {d.status === 'pendente' && (
            <Button size="sm" onClick={() => setPagarOpen(true)}><CheckCircle2 className="h-4 w-4" /> Pagar</Button>
          )}
          <button onClick={onEditar} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Editar"><Pencil className="h-4 w-4" /></button>
          <button onClick={apagar} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Excluir"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      {pagarOpen && <PagarDespesaModal despesa={d} onClose={() => setPagarOpen(false)} />}
    </Card>
  )
}

const FORMAS: OrderPaymentMethod[] = ['dinheiro', 'pix', 'transferencia', 'boleto', 'debito', 'credito', 'outro']

function PagarDespesaModal({ despesa, onClose }: { despesa: Despesa; onClose: () => void }) {
  const toast = useToast()
  const pagar = usePagarDespesa()
  const { data: contas } = useContas()
  const [forma, setForma] = useState<OrderPaymentMethod>('pix')
  const [contaId, setContaId] = useState('')

  async function confirmar() {
    try {
      await pagar.mutateAsync({ id: despesa.id, forma, conta_id: contaId || undefined })
      toast.success('Despesa paga!')
      onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro.') }
  }

  return (
    <Modal open onClose={onClose} title="Registrar pagamento" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={confirmar} loading={pagar.isPending}>Confirmar</Button></>}>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
          <span className="truncate text-sm font-medium text-slate-700">{despesa.descricao}</span>
          <span className="font-bold tabular text-slate-900">{formatBRL(despesa.valor)}</span>
        </div>
        <Field label="Forma de pagamento">
          <Select value={forma} onChange={(e) => setForma(e.target.value as OrderPaymentMethod)}>
            {FORMAS.map((f) => <option key={f} value={f}>{ORDER_PAYMENT_LABELS[f]}</option>)}
          </Select>
        </Field>
        <Field label="Abater de qual conta?" hint="opcional — reduz o saldo da conta escolhida">
          <Select value={contaId} onChange={(e) => setContaId(e.target.value)}>
            <option value="">Não abater de conta</option>
            {contas?.map((c) => <option key={c.id} value={c.id}>{c.nome} ({formatBRL(c.saldo)})</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}

function DespesaForm({ despesa, onClose }: { despesa?: Despesa; onClose: () => void }) {
  const toast = useToast()
  const salvar = useSalvarDespesa()
  const [descricao, setDescricao] = useState(despesa?.descricao ?? '')
  const [categoria, setCategoria] = useState<ExpenseCategory>(despesa?.categoria ?? 'fornecedor')
  const [beneficiario, setBeneficiario] = useState(despesa?.beneficiario ?? '')
  const [valor, setValor] = useState(despesa?.valor ?? 0)
  const [vencimento, setVencimento] = useState(despesa?.data_vencimento ?? '')
  const [observacao, setObservacao] = useState(despesa?.observacao ?? '')

  async function submeter() {
    if (!descricao.trim()) return toast.error('Informe a descrição.')
    if (!(valor > 0)) return toast.error('Informe um valor maior que zero.')
    const input: DespesaInput = {
      descricao: descricao.trim(), categoria, beneficiario: beneficiario.trim() || undefined,
      valor: Number(valor), data_vencimento: vencimento || undefined, observacao: observacao.trim() || undefined,
    }
    try {
      await salvar.mutateAsync({ id: despesa?.id, input })
      toast.success(despesa ? 'Despesa atualizada.' : 'Despesa lançada.')
      onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro.') }
  }

  return (
    <Modal open onClose={onClose} onSubmit={submeter} title={despesa ? 'Editar despesa' : 'Nova despesa'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={submeter} loading={salvar.isPending}>Salvar</Button></>}>
      <div className="space-y-4">
        <Field label="Descrição">
          <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={120} placeholder="ex.: Pedido de farinha, Salário Maria, Boleto energia" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoria">
            <Select value={categoria} onChange={(e) => setCategoria(e.target.value as ExpenseCategory)}>
              {CATEGORIAS.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}
            </Select>
          </Field>
          <Field label="Valor">
            <MoneyInput value={valor} onChange={setValor} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fornecedor / beneficiário" hint="opcional">
            <Input value={beneficiario} onChange={(e) => setBeneficiario(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Vencimento" hint="opcional (boletos)">
            <DatePicker value={vencimento} onChange={setVencimento} />
          </Field>
        </div>
        <Field label="Observação" hint="opcional">
          <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  )
}

// ============================ Minhas contas ============================
function MinhasContas() {
  const { data: contas, isLoading } = useContas()
  const [editando, setEditando] = useState<Conta | null>(null)
  const [nova, setNova] = useState(false)
  const total = (contas ?? []).reduce((a, c) => a + Number(c.saldo), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
        <Button onClick={() => setNova(true)}><Plus className="h-4 w-4" /> Nova conta</Button>
      </div>

      <Card className="flex items-center justify-between bg-slate-900 p-5 text-white">
        <span className="flex items-center gap-2 text-sm text-slate-300"><Wallet className="h-5 w-5" /> Total nas contas</span>
        <span className="text-2xl font-bold tabular">{formatBRL(total)}</span>
      </Card>

      {isLoading ? (
        <CenterSpinner />
      ) : !contas || contas.length === 0 ? (
        <Card><EmptyState title="Nenhuma conta" description="Cadastre suas contas (Caixa, Banco...) e informe o saldo atual." /></Card>
      ) : (
        <div className="space-y-2">
          {contas.map((c) => (
            <Card key={c.id} className="flex items-center justify-between p-4">
              <span className="flex items-center gap-2 font-medium text-slate-800"><Landmark className="h-4 w-4 text-slate-400" /> {c.nome}</span>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold tabular text-slate-900">{formatBRL(c.saldo)}</span>
                <button onClick={() => setEditando(c)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {nova && <ContaForm onClose={() => setNova(false)} />}
      {editando && <ContaForm conta={editando} onClose={() => setEditando(null)} />}
    </div>
  )
}

function ContaForm({ conta, onClose }: { conta?: Conta; onClose: () => void }) {
  const toast = useToast()
  const salvar = useSalvarConta()
  const excluir = useExcluirConta()
  const [nome, setNome] = useState(conta?.nome ?? '')
  const [saldo, setSaldo] = useState(conta?.saldo ?? 0)

  async function submeter() {
    if (!nome.trim()) return toast.error('Informe o nome da conta.')
    try {
      await salvar.mutateAsync({ id: conta?.id, nome: nome.trim(), saldo: Number(saldo) })
      toast.success('Conta salva.')
      onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro.') }
  }
  async function apagar() {
    if (!conta) return
    if (!confirm(`Excluir a conta "${conta.nome}"?`)) return
    try { await excluir.mutateAsync(conta.id); toast.success('Conta excluída.'); onClose() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Erro.') }
  }

  return (
    <Modal open onClose={onClose} onSubmit={submeter} title={conta ? 'Editar conta' : 'Nova conta'} size="sm"
      footer={
        <>
          {conta && <Button variant="danger" onClick={apagar} className="mr-auto">Excluir</Button>}
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submeter} loading={salvar.isPending}>Salvar</Button>
        </>
      }>
      <div className="space-y-4">
        <Field label="Nome da conta">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} placeholder="ex.: Caixa, Banco do Brasil, Nubank" autoFocus />
        </Field>
        <Field label="Saldo atual">
          <MoneyInput value={saldo} onChange={setSaldo} />
        </Field>
      </div>
    </Modal>
  )
}

function Tab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition',
      active ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100')}>
      {icon}{children}
    </button>
  )
}
