import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, ShieldCheck, TrendingUp, TrendingDown, Download, DollarSign, ArrowRight, Receipt, ChevronDown, Trash2 } from 'lucide-react'
import {
  useResumoVendas, useProdutosVendidos, usePorFuncionario, useTotais, useVendasPorDia, useVendasDetalhe,
  useExcluirVenda, buscarVendasParaExport,
} from './api'
import { useContasReceber } from '@/features/encomendas/api'
import { AuditoriaCaixa } from './AuditoriaCaixa'
import { PAYMENT_LABELS } from '@/types/db'
import { Card, CardHeader, CenterSpinner, EmptyState, Field, Button } from '@/components/ui'
import { DatePicker } from '@/components/DateTimePicker'
import { useAuth } from '@/auth/AuthProvider'
import { useToast } from '@/components/toast'
import {
  formatBRL, formatQty, formatDecimalBR, formatDataBR, formatDataHora, hojeData, hojeMaisDias,
  primeiroDiaDoMes, ultimoDiaDoMes, inicioDoDiaISO, fimDoDiaExclusivoISO, cn,
} from '@/lib/utils'

type Aba = 'resumo' | 'vendas' | 'caixa'

export function RelatoriosPage() {
  const [aba, setAba] = useState<Aba>('resumo')
  const [de, setDe] = useState(hojeData())
  const [ate, setAte] = useState(hojeData())

  // Garante ordem (evita "De > Até").
  const [d1, d2] = de <= ate ? [de, ate] : [ate, de]
  const inicio = inicioDoDiaISO(d1)
  const fim = fimDoDiaExclusivoISO(d2)

  const presets = [
    { label: 'Hoje', on: () => { setDe(hojeData()); setAte(hojeData()) } },
    { label: 'Ontem', on: () => { const d = hojeMaisDias(-1); setDe(d); setAte(d) } },
    { label: '7 dias', on: () => { setDe(hojeMaisDias(-6)); setAte(hojeData()) } },
    { label: 'Este mês', on: () => { setDe(primeiroDiaDoMes(0)); setAte(hojeData()) } },
    { label: 'Mês passado', on: () => { setDe(primeiroDiaDoMes(-1)); setAte(ultimoDiaDoMes(-1)) } },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Relatórios</h1>

      <div className="flex flex-wrap gap-2">
        <TabButton active={aba === 'resumo'} onClick={() => setAba('resumo')} icon={<BarChart3 className="h-4 w-4" />}>Resumo</TabButton>
        <TabButton active={aba === 'vendas'} onClick={() => setAba('vendas')} icon={<Receipt className="h-4 w-4" />}>Venda a venda</TabButton>
        <TabButton active={aba === 'caixa'} onClick={() => setAba('caixa')} icon={<ShieldCheck className="h-4 w-4" />}>Caixa</TabButton>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="De"><DatePicker value={de} onChange={setDe} clearable={false} className="w-40" /></Field>
          <Field label="Até"><DatePicker value={ate} onChange={setAte} clearable={false} className="w-40" /></Field>
          <div className="flex flex-wrap gap-1 pb-0.5">
            {presets.map((p) => (
              <button key={p.label} onClick={p.on} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200">
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {aba === 'resumo' && <RelatorioVendas inicio={inicio} fim={fim} periodo={`${formatDataBR(d1)} a ${formatDataBR(d2)}`} />}
      {aba === 'vendas' && <RelatorioDetalhe key={inicio + fim} inicio={inicio} fim={fim} periodo={`${formatDataBR(d1)} a ${formatDataBR(d2)}`} />}
      {aba === 'caixa' && <AuditoriaCaixa inicio={inicio} fim={fim} />}
    </div>
  )
}

function RelatorioVendas({ inicio, fim, periodo }: { inicio: string; fim: string; periodo: string }) {
  const { data: totais, isLoading } = useTotais(inicio, fim)
  const { data: resumo } = useResumoVendas(inicio, fim)
  const { data: porFunc } = usePorFuncionario(inicio, fim)
  const { data: produtos } = useProdutosVendidos(inicio, fim)
  const { data: porDia } = useVendasPorDia(inicio, fim)
  const { data: contas } = useContasReceber()
  const [ordProd, setOrdProd] = useState<'total' | 'quantidade'>('total')

  const produtosOrd = [...(produtos ?? [])].sort((a, b) =>
    ordProd === 'total' ? b.total - a.total : b.quantidade - a.quantidade,
  )

  // Período anterior de mesma duração, para comparativo.
  const durMs = new Date(fim).getTime() - new Date(inicio).getTime()
  const prevInicio = new Date(new Date(inicio).getTime() - durMs).toISOString()
  const { data: totaisAnterior } = useTotais(prevInicio, inicio)

  const receita = totais?.receita ?? 0
  const lucro = totais?.lucro ?? 0
  const margem = receita > 0 ? (lucro / receita) * 100 : 0
  const deltaReceita = totaisAnterior && totaisAnterior.receita > 0
    ? ((receita - totaisAnterior.receita) / totaisAnterior.receita) * 100
    : null

  const totalReceber = (contas ?? []).reduce((a, c) => a + Number(c.total), 0)

  function exportarCSV() {
    const linhas: (string | number)[][] = [
      ['Relatório de vendas', periodo],
      [],
      ['Receita', formatDecimalBR(receita)],
      ['Descontos concedidos', formatDecimalBR(totais?.descontos ?? 0)],
      ['Custo estimado', formatDecimalBR(totais?.custo ?? 0)],
      ['Lucro estimado', formatDecimalBR(lucro)],
      ['Nº de vendas', totais?.qtd_vendas ?? 0],
      ['Ticket médio', formatDecimalBR(totais?.ticket_medio ?? 0)],
      ['Vendas canceladas', `${totais?.canceladas_qtd ?? 0} (${formatDecimalBR(totais?.canceladas_valor ?? 0)})`],
      [],
      ['Forma de pagamento', 'Qtd', 'Total'],
      ...(resumo ?? []).map((r) => [PAYMENT_LABELS[r.forma_pagamento], r.qtd_vendas, formatDecimalBR(r.total)]),
      [],
      ['Funcionário', 'Vendas', 'Total'],
      ...(porFunc ?? []).map((f) => [f.nome, f.qtd_vendas, formatDecimalBR(f.total)]),
      [],
      ['Produto', 'Qtd', 'Total', 'Lucro'],
      ...(produtos ?? []).map((p) => [p.product_nome, formatQty(p.quantidade), formatDecimalBR(p.total), formatDecimalBR(p.lucro)]),
    ]
    const csv = '﻿' + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `relatorio-vendas-${inicio.slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) return <CenterSpinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Período: <span className="font-medium text-slate-700">{periodo}</span></p>
        <Button variant="outline" size="sm" onClick={exportarCSV}><Download className="h-4 w-4" /> Exportar CSV</Button>
      </div>

      {/* Métricas principais */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BigMetric label="Total vendido" value={formatBRL(receita)} delta={deltaReceita} tone="brand" />
        <BigMetric label="Lucro estimado" value={formatBRL(lucro)} sub={`margem ${margem.toFixed(0)}%`} tone="green" />
        <BigMetric label="Ticket médio" value={formatBRL(totais?.ticket_medio ?? 0)} />
        <BigMetric label="Nº de vendas" value={String(totais?.qtd_vendas ?? 0)} sub={totais && totais.canceladas_qtd > 0 ? `${totais.canceladas_qtd} cancelada(s)` : undefined} />
      </div>

      {/* Descontos + Contas a receber */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm text-slate-500">Descontos concedidos</p>
            <p className="mt-0.5 text-xl font-bold tabular text-slate-900">{formatBRL(totais?.descontos ?? 0)}</p>
          </div>
          <DollarSign className="h-8 w-8 text-slate-200" />
        </Card>
        <Link to="/app/encomendas">
          <Card className={cn('flex items-center justify-between p-4 transition hover:shadow', totalReceber > 0 && 'border-amber-200 bg-amber-50')}>
            <div>
              <p className="text-sm text-slate-500">A receber (encomendas)</p>
              <p className="mt-0.5 text-xl font-bold tabular text-slate-900">{formatBRL(totalReceber)}</p>
            </div>
            <ArrowRight className="h-6 w-6 text-slate-300" />
          </Card>
        </Link>
      </div>

      {/* Vendas por dia */}
      {porDia && porDia.length > 1 && (
        <Card>
          <CardHeader title="Vendas por dia" />
          <div className="p-4"><GraficoDias dados={porDia} /></div>
        </Card>
      )}

      {/* Formas de pagamento com % */}
      <Card>
        <CardHeader title="Por forma de pagamento" />
        {!resumo || resumo.length === 0 ? (
          <EmptyState title="Sem vendas no período" />
        ) : (
          <div className="divide-y divide-slate-100">
            {resumo.map((r) => {
              const pct = receita > 0 ? (r.total / receita) * 100 : 0
              return (
                <div key={r.forma_pagamento} className="px-5 py-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{PAYMENT_LABELS[r.forma_pagamento]}</span>
                    <span className="text-slate-500">{r.qtd_vendas} venda(s) • {pct.toFixed(0)}%</span>
                    <span className="w-24 text-right font-semibold tabular text-slate-900">{formatBRL(r.total)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-400" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Por funcionário */}
      <Card>
        <CardHeader title="Vendas por funcionário" />
        {!porFunc || porFunc.length === 0 ? (
          <EmptyState title="Sem dados" />
        ) : (
          <div className="divide-y divide-slate-100">
            {porFunc.map((f) => (
              <div key={f.funcionario_id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="font-medium text-slate-800">{f.nome}</span>
                <span className="text-slate-500">{f.qtd_vendas} venda(s)</span>
                <span className="w-24 text-right font-semibold tabular text-slate-900">{formatBRL(f.total)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Produtos mais vendidos com lucro */}
      <Card>
        <CardHeader
          title="Produtos mais vendidos"
          subtitle="lucro estimado (itens sem custo contam como custo zero)"
          action={
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
              <button
                onClick={() => setOrdProd('total')}
                className={cn('rounded-md px-2.5 py-1', ordProd === 'total' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}
              >
                Faturamento
              </button>
              <button
                onClick={() => setOrdProd('quantidade')}
                className={cn('rounded-md px-2.5 py-1', ordProd === 'quantidade' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}
              >
                Quantidade
              </button>
            </div>
          }
        />
        {produtosOrd.length === 0 ? (
          <EmptyState title="Sem dados" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-2">Produto</th>
                  <th className="px-2 py-2 text-right">Qtd</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-5 py-2 text-right">Lucro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {produtosOrd.map((p) => (
                  <tr key={p.product_id ?? p.product_nome}>
                    <td className="px-5 py-2.5 font-medium text-slate-800">{p.product_nome}</td>
                    <td className="px-2 py-2.5 text-right text-slate-500">{formatQty(p.quantidade)}</td>
                    <td className="px-2 py-2.5 text-right tabular text-slate-900">{formatBRL(p.total)}</td>
                    <td className="px-5 py-2.5 text-right font-semibold tabular text-emerald-600">{formatBRL(p.lucro)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function RelatorioDetalhe({ inicio, fim, periodo }: { inicio: string; fim: string; periodo: string }) {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const excluir = useExcluirVenda()
  const [limite, setLimite] = useState(30)
  const [aberta, setAberta] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)
  const { data, isLoading } = useVendasDetalhe(inicio, fim, limite)

  const vendas = data?.rows ?? []
  const total = data?.total ?? 0

  async function apagarVenda(id: string) {
    if (!confirm('Excluir esta venda? O estoque será devolvido. Não dá para desfazer.')) return
    try { await excluir.mutateAsync(id); toast.success('Venda excluída.') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Erro.') }
  }

  // Exporta TODAS as vendas do período (não só a página carregada).
  async function exportarCSV() {
    setExportando(true)
    try {
      const todas = await buscarVendasParaExport(inicio, fim)
      const linhas: (string | number)[][] = [
        ['Data/hora', 'Cliente', 'Pagamento', 'Operador', 'Total', 'Itens'],
        ...todas.map((v) => [
          formatDataHora(v.created_at),
          v.cliente_nome ?? '',
          PAYMENT_LABELS[v.forma_pagamento],
          v.funcionario?.nome ?? '',
          formatDecimalBR(v.total),
          v.sale_items.map((i) => `${formatQty(i.quantidade)}x ${i.product_nome}`).join(' | '),
        ]),
      ]
      const csv = '﻿' + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vendas-${inicio.slice(0, 10)}_a_${fim.slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao exportar.')
    } finally {
      setExportando(false)
    }
  }

  if (isLoading) return <CenterSpinner />

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          <span className="font-semibold text-slate-700">{total}</span> venda(s) · {periodo}
        </p>
        {total > 0 && (
          <Button variant="outline" size="sm" onClick={exportarCSV} loading={exportando}><Download className="h-4 w-4" /> Exportar CSV</Button>
        )}
      </div>

      {vendas.length === 0 ? (
        <Card><EmptyState title="Nenhuma venda no período" /></Card>
      ) : (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {vendas.map((v) => (
            <div key={v.id}>
              <button onClick={() => setAberta((a) => (a === v.id ? null : v.id))} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {formatDataHora(v.created_at)}{v.cliente_nome ? ` • ${v.cliente_nome}` : ''}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {PAYMENT_LABELS[v.forma_pagamento]} · {v.funcionario?.nome ?? '—'} · {v.sale_items.length} item(s)
                  </p>
                </div>
                <span className="shrink-0 font-bold tabular text-slate-900">{formatBRL(v.total)}</span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition', aberta === v.id && 'rotate-180')} />
              </button>
              {aberta === v.id && (
                <div className="bg-slate-50 px-4 py-2 text-sm">
                  {v.sale_items.map((it, i) => (
                    <div key={i} className="flex justify-between py-0.5 text-slate-600">
                      <span className="truncate">{formatQty(it.quantidade)}× {it.product_nome}</span>
                      <span className="tabular">{formatBRL(it.subtotal)}</span>
                    </div>
                  ))}
                  {v.desconto > 0 && (
                    <div className="flex justify-between py-0.5 font-medium text-red-500">
                      <span>Desconto</span><span className="tabular">- {formatBRL(v.desconto)}</span>
                    </div>
                  )}
                  {isAdmin && (
                    <div className="mt-2 flex justify-end border-t border-slate-200 pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => apagarVenda(v.id)}
                        disabled={excluir.isPending}
                      >
                        <Trash2 className="h-4 w-4" /> Excluir venda
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {vendas.length < total && (
            <div className="flex justify-center py-3">
              <Button variant="outline" size="sm" onClick={() => setLimite((l) => l + 30)}>
                Carregar mais ({total - vendas.length} restantes)
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function GraficoDias({ dados }: { dados: { dia: string; total: number }[] }) {
  const max = Math.max(...dados.map((d) => d.total), 1)
  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-2" style={{ minHeight: 140 }}>
      {dados.map((d) => (
        <div key={d.dia} className="flex min-w-[36px] flex-1 flex-col items-center gap-1">
          <span className="text-[10px] font-medium text-slate-500">{formatBRL(d.total).replace('R$', '').trim()}</span>
          <div
            className="w-full rounded-t bg-brand-400"
            style={{ height: `${Math.max((d.total / max) * 100, 3)}px` }}
            title={`${formatDataBR(d.dia)}: ${formatBRL(d.total)}`}
          />
          <span className="text-[10px] text-slate-400">{formatDataBR(d.dia).slice(0, 5)}</span>
        </div>
      ))}
    </div>
  )
}

function BigMetric({ label, value, sub, delta, tone }: {
  label: string; value: string; sub?: string; delta?: number | null; tone?: 'brand' | 'green'
}) {
  return (
    <Card className={cn('p-4', tone === 'brand' && 'bg-brand-600 text-white', tone === 'green' && 'bg-emerald-600 text-white')}>
      <p className={cn('text-xs', tone ? 'text-white/80' : 'text-slate-500')}>{label}</p>
      <p className="mt-1 text-2xl font-bold tabular">{value}</p>
      {delta != null && (
        <p className={cn('mt-0.5 inline-flex items-center gap-1 text-xs font-semibold', tone ? 'text-white/90' : delta >= 0 ? 'text-emerald-600' : 'text-red-600')}>
          {delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {delta >= 0 ? '+' : ''}{delta.toFixed(0)}% vs. período anterior
        </p>
      )}
      {sub && <p className={cn('mt-0.5 text-xs', tone ? 'text-white/80' : 'text-slate-400')}>{sub}</p>}
    </Card>
  )
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition',
        active ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100',
      )}
    >
      {icon}
      {children}
    </button>
  )
}
