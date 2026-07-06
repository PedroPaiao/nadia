import { useState } from 'react'
import { Wallet, LockOpen, ArrowDownLeft, ArrowUpRight, DoorClosed, Banknote, Trash2 } from 'lucide-react'
import {
  useCaixaAberto,
  useCaixaResumo,
  useMovimentosCaixa,
  useAbrirCaixa,
  useFecharCaixa,
  useRegistrarMovimentoCaixa,
  useExcluirMovimentoCaixa,
} from './api'
import type { CashMovementType } from '@/types/db'
import { Button, Card, CardHeader, CenterSpinner, Input, Field, Textarea, Modal, Badge, MoneyInput } from '@/components/ui'
import { useAuth } from '@/auth/AuthProvider'
import { useToast } from '@/components/toast'
import { formatBRL, cn } from '@/lib/utils'

export function CaixaPage() {
  const { data: caixa, isLoading } = useCaixaAberto()

  if (isLoading) return <CenterSpinner label="Carregando caixa…" />

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Caixa</h1>
      {caixa ? <CaixaAberto sessionId={caixa.id} caixa={caixa} /> : <AbrirCaixa />}
    </div>
  )
}

function AbrirCaixa() {
  const toast = useToast()
  const abrir = useAbrirCaixa()
  const [valor, setValor] = useState(0)
  const [obs, setObs] = useState('')

  async function handleAbrir() {
    try {
      await abrir.mutateAsync({ valor_abertura: Number(valor) || 0, observacao: obs.trim() || undefined })
      toast.success('Caixa aberto!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao abrir caixa.')
    }
  }

  return (
    <Card>
      <CardHeader title="Abrir caixa" subtitle="Informe o valor inicial (fundo de troco) para começar o dia." />
      <div className="space-y-4 p-5">
        <Field label="Valor de abertura" hint="dinheiro em caixa no início">
          <MoneyInput value={valor} onChange={setValor} autoFocus />
        </Field>
        <Field label="Observação" hint="opcional">
          <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
        </Field>
        <Button size="lg" className="w-full" onClick={handleAbrir} loading={abrir.isPending}>
          <LockOpen className="h-5 w-5" /> Abrir caixa
        </Button>
      </div>
    </Card>
  )
}

function CaixaAberto({ sessionId, caixa }: { sessionId: string; caixa: { valor_abertura: number; aberto_em: string; funcionario: { nome: string } | null } }) {
  const toast = useToast()
  const { isAdmin } = useAuth()
  const { data: resumo } = useCaixaResumo(sessionId, isAdmin)
  const { data: movimentos } = useMovimentosCaixa(sessionId)
  const movimentar = useRegistrarMovimentoCaixa()
  const excluirMov = useExcluirMovimentoCaixa()
  const [movTipo, setMovTipo] = useState<CashMovementType | null>(null)
  const [fecharOpen, setFecharOpen] = useState(false)

  async function apagarMov(id: string) {
    if (!confirm('Excluir este movimento de caixa?')) return
    try { await excluirMov.mutateAsync(id); toast.success('Movimento excluído.') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Erro.') }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-slate-900">Caixa aberto</p>
              <p className="text-xs text-slate-500">
                {caixa.funcionario?.nome ? `por ${caixa.funcionario.nome} • ` : ''}
                desde {new Date(caixa.aberto_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
          <Badge tone="green">Aberto</Badge>
        </div>

        {isAdmin ? (
          <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3">
            <Metric label="Abertura" value={caixa.valor_abertura} />
            <Metric label="Vendas dinheiro" value={resumo?.vendas_dinheiro ?? 0} />
            <Metric label="Vendas cartão/Pix" value={resumo?.vendas_outras ?? 0} />
            <Metric label="Suprimentos" value={resumo?.suprimentos ?? 0} tone="emerald" />
            <Metric label="Sangrias" value={resumo?.sangrias ?? 0} tone="red" />
            <Metric label="Esperado em dinheiro" value={resumo?.esperado_dinheiro ?? 0} highlight />
          </div>
        ) : (
          <div className="flex items-center justify-between px-5 py-4 text-sm">
            <span className="text-slate-500">Fundo de troco (abertura)</span>
            <span className="font-bold tabular text-slate-900">{formatBRL(caixa.valor_abertura)}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2 p-4">
          <Button variant="outline" onClick={() => setMovTipo('suprimento')}>
            <ArrowUpRight className="h-4 w-4 text-emerald-600" /> Suprimento
          </Button>
          <Button variant="outline" onClick={() => setMovTipo('sangria')}>
            <ArrowDownLeft className="h-4 w-4 text-red-600" /> Sangria
          </Button>
          <Button variant="danger" className="ml-auto" onClick={() => setFecharOpen(true)}>
            <DoorClosed className="h-4 w-4" /> Fechar caixa
          </Button>
        </div>
      </Card>

      {isAdmin && (
        <Card className="overflow-hidden">
          <CardHeader title="Movimentos do caixa" subtitle="Sangrias e suprimentos" />
          {!movimentos || movimentos.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-slate-400">Nenhum movimento ainda.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {movimentos.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    {m.tipo === 'suprimento' ? (
                      <ArrowUpRight className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <ArrowDownLeft className="h-4 w-4 text-red-600" />
                    )}
                    <span className="font-medium capitalize text-slate-800">{m.tipo}</span>
                    {m.motivo && <span className="text-slate-400">— {m.motivo}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn('font-semibold tabular', m.tipo === 'suprimento' ? 'text-emerald-600' : 'text-red-600')}>
                      {m.tipo === 'suprimento' ? '+' : '-'} {formatBRL(m.valor)}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button onClick={() => apagarMov(m.id)} className="text-slate-300 hover:text-red-500" title="Excluir">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {movTipo && (
        <MovimentoCaixaModal
          tipo={movTipo}
          onClose={() => setMovTipo(null)}
          onConfirm={async (valor, motivo) => {
            try {
              await movimentar.mutateAsync({ tipo: movTipo, valor, motivo })
              toast.success(movTipo === 'sangria' ? 'Sangria registrada.' : 'Suprimento registrado.')
              setMovTipo(null)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Erro.')
            }
          }}
          loading={movimentar.isPending}
        />
      )}

      {fecharOpen && <FecharCaixaModal sessionId={sessionId} isAdmin={isAdmin} onClose={() => setFecharOpen(false)} />}
    </div>
  )
}

function Metric({ label, value, tone, highlight }: { label: string; value: number; tone?: 'emerald' | 'red'; highlight?: boolean }) {
  return (
    <div className={cn('bg-white p-4', highlight && 'bg-brand-50')}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cn('mt-0.5 text-lg font-bold tabular', tone === 'emerald' && 'text-emerald-600', tone === 'red' && 'text-red-600', highlight && 'text-brand-700', !tone && !highlight && 'text-slate-900')}>
        {formatBRL(value)}
      </p>
    </div>
  )
}

function MovimentoCaixaModal({
  tipo,
  onClose,
  onConfirm,
  loading,
}: {
  tipo: CashMovementType
  onClose: () => void
  onConfirm: (valor: number, motivo?: string) => void
  loading: boolean
}) {
  const [valor, setValor] = useState(0)
  const [motivo, setMotivo] = useState('')
  const titulo = tipo === 'sangria' ? 'Sangria (retirada)' : 'Suprimento (reforço)'

  return (
    <Modal
      open
      onClose={onClose}
      onSubmit={() => { if (valor > 0) onConfirm(Number(valor) || 0, motivo.trim() || undefined) }}
      title={titulo}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onConfirm(Number(valor) || 0, motivo.trim() || undefined)} loading={loading} disabled={!valor || valor <= 0}>
            Confirmar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Valor">
          <MoneyInput value={valor} onChange={setValor} autoFocus />
        </Field>
        <Field label="Motivo" hint="opcional">
          <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={tipo === 'sangria' ? 'ex.: pagamento fornecedor' : 'ex.: reforço de troco'} />
        </Field>
      </div>
    </Modal>
  )
}

function FecharCaixaModal({ sessionId, isAdmin, onClose }: { sessionId: string; isAdmin: boolean; onClose: () => void }) {
  const toast = useToast()
  const { data: resumo } = useCaixaResumo(sessionId, isAdmin)
  const fechar = useFecharCaixa()
  const [contado, setContado] = useState(0)

  const esperado = resumo?.esperado_dinheiro ?? 0
  const diferenca = (Number(contado) || 0) - esperado

  async function handleFechar() {
    try {
      await fechar.mutateAsync({ valor_informado: Number(contado) || 0 })
      toast.success('Caixa fechado.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao fechar.')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      onSubmit={handleFechar}
      title="Fechar caixa"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={handleFechar} loading={fechar.isPending}>Fechar caixa</Button>
        </>
      }
    >
      <div className="space-y-4">
        {isAdmin ? (
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="flex items-center gap-2 text-sm text-slate-600"><Banknote className="h-4 w-4" /> Esperado em dinheiro</span>
            <span className="text-lg font-bold tabular text-slate-900">{formatBRL(esperado)}</span>
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <Banknote className="mt-0.5 h-4 w-4 shrink-0" />
            Conte <b>todo o dinheiro da gaveta</b> e informe o valor abaixo. A conferência é feita pela administradora.
          </p>
        )}

        <Field label="Valor contado na gaveta" hint="conte o dinheiro físico">
          <MoneyInput value={contado} onChange={setContado} autoFocus />
        </Field>

        {isAdmin && contado > 0 && (
          <div
            className={cn(
              'flex items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold',
              Math.abs(diferenca) < 0.005 ? 'bg-emerald-50 text-emerald-700' : diferenca < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700',
            )}
          >
            <span>Diferença</span>
            <span className="tabular">
              {diferenca > 0 ? '+' : ''}{formatBRL(diferenca)}
              {Math.abs(diferenca) < 0.005 ? ' (confere)' : diferenca < 0 ? ' (falta)' : ' (sobra)'}
            </span>
          </div>
        )}
      </div>
    </Modal>
  )
}
