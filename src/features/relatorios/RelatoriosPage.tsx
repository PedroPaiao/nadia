import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, ShieldCheck, TrendingUp, TrendingDown, Download, DollarSign, ArrowRight } from 'lucide-react'
import {
  useResumoVendas, useProdutosVendidos, usePorFuncionario, useTotais, useVendasPorDia,
} from './api'
import { useContasReceber } from '@/features/encomendas/api'
import { AuditoriaCaixa } from './AuditoriaCaixa'
import { PAYMENT_LABELS } from '@/types/db'
import { Card, CardHeader, CenterSpinner, EmptyState, Field, Button } from '@/components/ui'
import { DatePicker } from '@/components/DateTimePicker'
import {
  formatBRL, formatQty, formatDecimalBR, formatDataBR, hojeData, hojeMaisDias,
  primeiroDiaDoMes, ultimoDiaDoMes, inicioDoDiaISO, fimDoDiaExclusivoISO, cn,
} from '@/lib/utils'

type Aba = 'vendas' | 'caixa'

export function RelatoriosPage() {
  const [aba, setAba] = useState<Aba>('vendas')
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

      <div className="flex gap-2">
        <TabButton active={aba === 'vendas'} onClick={() => setAba('vendas')} icon={<BarChart3 className="h-4 w-4" />}>Vendas</TabButton>
        <TabButton active={aba === 'caixa'} onClick={() => setAba('caixa')} icon={<ShieldCheck className="h-4 w-4" />}>Auditoria de Caixa</TabButton>
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

      {aba === 'vendas' ? <RelatorioVendas inicio={inicio} fim={fim} periodo={`${formatDataBR(d1)} a ${formatDataBR(d2)}`} /> : <AuditoriaCaixa inicio={inicio} fim={fim} />}
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
        <CardHeader title="Produtos mais vendidos" subtitle="lucro estimado (itens sem custo cadastrado contam como custo zero)" />
        {!produtos || produtos.length === 0 ? (
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
                {produtos.map((p) => (
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
