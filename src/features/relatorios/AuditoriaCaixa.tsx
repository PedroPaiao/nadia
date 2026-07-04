import { useState } from 'react'
import { Lock, ChevronRight } from 'lucide-react'
import { useHistoricoCaixa, useVendasSessao, type HistoricoCaixaRow } from './api'
import { useCaixaResumo, useMovimentosCaixa } from '@/features/caixa/api'
import { PAYMENT_LABELS } from '@/types/db'
import { Card, CardHeader, CenterSpinner, EmptyState, Badge, Modal } from '@/components/ui'
import { formatBRL, formatDataHora, cn } from '@/lib/utils'

export function AuditoriaCaixa({ inicio, fim }: { inicio: string; fim: string }) {
  const { data: sessoes, isLoading } = useHistoricoCaixa(inicio, fim)
  const [detalhe, setDetalhe] = useState<HistoricoCaixaRow | null>(null)

  if (isLoading) return <CenterSpinner />

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader title="Aberturas e fechamentos de caixa" subtitle="Registros imutáveis para conferência." />
        {!sessoes || sessoes.length === 0 ? (
          <EmptyState title="Nenhuma sessão de caixa no período" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Abertura</th>
                  <th className="px-4 py-3">Operador</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Esperado</th>
                  <th className="px-4 py-3 text-right">Contado</th>
                  <th className="px-4 py-3 text-right">Diferença</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessoes.map((s) => {
                  const fechado = s.status === 'fechado'
                  const dif =
                    fechado && s.valor_fechamento_informado != null && s.valor_fechamento_calculado != null
                      ? s.valor_fechamento_informado - s.valor_fechamento_calculado
                      : null
                  return (
                    <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetalhe(s)}>
                      <td className="px-4 py-3 text-slate-700">{formatDataHora(s.aberto_em)}</td>
                      <td className="px-4 py-3 text-slate-600">{s.funcionario?.nome ?? '—'}</td>
                      <td className="px-4 py-3">
                        {fechado ? <Badge tone="gray">Fechado</Badge> : <Badge tone="green">Aberto</Badge>}
                      </td>
                      <td className="px-4 py-3 text-right tabular text-slate-600">
                        {s.valor_fechamento_calculado != null ? formatBRL(s.valor_fechamento_calculado) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular text-slate-600">
                        {s.valor_fechamento_informado != null ? formatBRL(s.valor_fechamento_informado) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {dif == null ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <span className={cn('font-semibold tabular', Math.abs(dif) < 0.005 ? 'text-emerald-600' : dif < 0 ? 'text-red-600' : 'text-amber-600')}>
                            {dif > 0 ? '+' : ''}{formatBRL(dif)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300"><ChevronRight className="ml-auto h-4 w-4" /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {detalhe && <SessaoDetalheModal sessao={detalhe} onClose={() => setDetalhe(null)} />}
    </>
  )
}

function SessaoDetalheModal({ sessao, onClose }: { sessao: HistoricoCaixaRow; onClose: () => void }) {
  const { data: resumo } = useCaixaResumo(sessao.id)
  const { data: movimentos } = useMovimentosCaixa(sessao.id)
  const { data: vendas } = useVendasSessao(sessao.id)

  const dif = resumo?.diferenca ?? null

  return (
    <Modal open onClose={onClose} title="Detalhe da sessão de caixa" size="lg">
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <Lock className="h-3.5 w-3.5" /> Registro imutável — {formatDataHora(sessao.aberto_em)}
          {sessao.fechado_em && <> → {formatDataHora(sessao.fechado_em)}</>}
          {sessao.funcionario?.nome && <> • {sessao.funcionario.nome}</>}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Cell label="Abertura" value={formatBRL(resumo?.valor_abertura ?? sessao.valor_abertura)} />
          <Cell label="Vendas dinheiro" value={formatBRL(resumo?.vendas_dinheiro ?? 0)} />
          <Cell label="Vendas cartão/Pix" value={formatBRL(resumo?.vendas_outras ?? 0)} />
          <Cell label="Suprimentos" value={formatBRL(resumo?.suprimentos ?? 0)} />
          <Cell label="Sangrias" value={formatBRL(resumo?.sangrias ?? 0)} />
          <Cell label="Esperado em dinheiro" value={formatBRL(resumo?.esperado_dinheiro ?? 0)} highlight />
        </div>

        {sessao.status === 'fechado' && (
          <div className="grid grid-cols-2 gap-2">
            <Cell label="Contado na gaveta" value={formatBRL(resumo?.informado ?? 0)} />
            <div className={cn('rounded-xl p-3', dif == null ? 'bg-slate-50' : Math.abs(dif) < 0.005 ? 'bg-emerald-50' : dif < 0 ? 'bg-red-50' : 'bg-amber-50')}>
              <p className="text-xs text-slate-500">Diferença</p>
              <p className={cn('mt-0.5 text-lg font-bold tabular', dif == null ? 'text-slate-900' : Math.abs(dif) < 0.005 ? 'text-emerald-700' : dif < 0 ? 'text-red-700' : 'text-amber-700')}>
                {dif != null && dif > 0 ? '+' : ''}{formatBRL(dif ?? 0)}
              </p>
            </div>
          </div>
        )}

        {movimentos && movimentos.length > 0 && (
          <div>
            <p className="mb-1 font-semibold text-slate-700">Sangrias / Suprimentos</p>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {movimentos.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-3 py-2">
                  <span className="capitalize text-slate-700">{m.tipo}{m.motivo ? ` — ${m.motivo}` : ''}</span>
                  <span className={cn('font-semibold tabular', m.tipo === 'suprimento' ? 'text-emerald-600' : 'text-red-600')}>
                    {m.tipo === 'suprimento' ? '+' : '-'} {formatBRL(m.valor)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 font-semibold text-slate-700">Vendas ({vendas?.length ?? 0})</p>
          {!vendas || vendas.length === 0 ? (
            <p className="rounded-xl border border-slate-200 px-3 py-4 text-center text-slate-400">Nenhuma venda.</p>
          ) : (
            <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {vendas.map((v) => (
                <div key={v.id} className={cn('flex items-center justify-between px-3 py-2', v.status === 'cancelada' && 'opacity-50')}>
                  <div>
                    <span className="text-slate-700">
                      {new Date(v.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • {PAYMENT_LABELS[v.forma_pagamento]}
                    </span>
                    {v.funcionario?.nome && <span className="text-slate-400"> • {v.funcionario.nome}</span>}
                    {v.status === 'cancelada' && <span className="ml-1 text-red-500">(cancelada)</span>}
                  </div>
                  <span className={cn('font-semibold tabular', v.status === 'cancelada' ? 'text-slate-400 line-through' : 'text-slate-900')}>
                    {formatBRL(v.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function Cell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn('rounded-xl p-3', highlight ? 'bg-brand-50' : 'bg-slate-50')}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cn('mt-0.5 font-bold tabular', highlight ? 'text-brand-700' : 'text-slate-900')}>{value}</p>
    </div>
  )
}
