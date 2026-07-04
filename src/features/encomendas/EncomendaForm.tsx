import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useProducts } from '@/features/produtos/api'
import { useCriarEncomenda, useAtualizarEncomenda, type EncomendaItemInput, type OrderComItens } from './api'
import type { DeliveryType } from '@/types/db'
import { Button, Field, Input, Textarea, Modal, MoneyInput, NumberInput } from '@/components/ui'
import { Combobox } from '@/components/Combobox'
import { DatePicker, TimePicker } from '@/components/DateTimePicker'
import { useToast } from '@/components/toast'
import { formatBRL, hojeMaisDias, maskTelefone, cn } from '@/lib/utils'

export function EncomendaForm({ encomenda, onClose }: { encomenda?: OrderComItens | null; onClose: () => void }) {
  const editing = !!encomenda
  const toast = useToast()
  const { data: produtos } = useProducts()
  const criar = useCriarEncomenda()
  const atualizar = useAtualizarEncomenda()

  const [cliente, setCliente] = useState(encomenda?.cliente_nome ?? '')
  const [whatsapp, setWhatsapp] = useState(encomenda?.cliente_whatsapp ?? '')
  const [tipoEntrega, setTipoEntrega] = useState<DeliveryType>(encomenda?.tipo_entrega ?? 'retirada')
  const [endereco, setEndereco] = useState(encomenda?.endereco ?? '')
  const [taxa, setTaxa] = useState(encomenda?.taxa_entrega ?? 0)
  const [dataAgendada, setDataAgendada] = useState(encomenda?.data_agendada ?? '')
  const [horaAgendada, setHoraAgendada] = useState(encomenda?.hora_agendada?.slice(0, 5) ?? '')
  const [descricao, setDescricao] = useState(encomenda?.descricao ?? '')
  const [observacao, setObservacao] = useState(encomenda?.observacao ?? '')
  const [previsaoPagamento, setPrevisaoPagamento] = useState(encomenda?.data_prevista_pagamento ?? '')
  const [itens, setItens] = useState<EncomendaItemInput[]>(
    encomenda?.order_items?.map((i) => ({
      product_id: i.product_id,
      product_nome: i.product_nome,
      quantidade: i.quantidade,
      preco_unitario: i.preco_unitario,
    })) ?? [],
  )
  const [total, setTotal] = useState(encomenda?.total ?? 0)
  const [totalTocado, setTotalTocado] = useState(editing)

  const subtotal = useMemo(() => itens.reduce((a, i) => a + i.quantidade * i.preco_unitario, 0), [itens])
  const sugerido = subtotal + (taxa || 0)

  useEffect(() => {
    if (!totalTocado) setTotal(sugerido)
  }, [sugerido, totalTocado])

  const saving = criar.isPending || atualizar.isPending

  function addProduto(productId: string) {
    const p = produtos?.find((x) => x.id === productId)
    if (!p) return
    setItens((prev) => {
      const ex = prev.find((i) => i.product_id === p.id)
      if (ex) return prev.map((i) => (i.product_id === p.id ? { ...i, quantidade: i.quantidade + 1 } : i))
      return [...prev, { product_id: p.id, product_nome: p.nome, quantidade: 1, preco_unitario: p.preco_venda }]
    })
  }

  async function salvar() {
    if (!cliente.trim()) return toast.error('Informe o nome do cliente.')
    if (tipoEntrega === 'entrega' && !endereco.trim()) return toast.error('Informe o endereço da entrega.')
    if (itens.length === 0 && total <= 0 && !descricao.trim())
      return toast.error('Adicione itens, um valor total ou uma descrição.')

    const input = {
      cliente_nome: cliente.trim(),
      items: editing ? [] : itens,
      total: Number(total) || 0,
      cliente_whatsapp: whatsapp.trim() || undefined,
      descricao: descricao.trim() || undefined,
      observacao: observacao.trim() || undefined,
      tipo_entrega: tipoEntrega,
      endereco: tipoEntrega === 'entrega' ? endereco.trim() : undefined,
      taxa_entrega: tipoEntrega === 'entrega' ? Number(taxa) || 0 : 0,
      data_agendada: dataAgendada || undefined,
      hora_agendada: horaAgendada || undefined,
      data_prevista_pagamento: previsaoPagamento || undefined,
    }

    try {
      if (editing && encomenda) {
        await atualizar.mutateAsync({ id: encomenda.id, input })
        toast.success('Encomenda atualizada.')
      } else {
        await criar.mutateAsync(input)
        toast.success('Encomenda criada.')
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
      title={editing ? 'Editar encomenda' : 'Nova encomenda'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} loading={saving}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Cliente / Órgão">
            <Input value={cliente} onChange={(e) => setCliente(e.target.value)} maxLength={120} autoFocus />
          </Field>
          <Field label="WhatsApp / contato" hint="opcional">
            <Input
              value={whatsapp}
              onChange={(e) => setWhatsapp(maskTelefone(e.target.value))}
              placeholder="(00) 00000-0000"
              inputMode="tel"
              maxLength={16}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Data agendada" hint="quando entregar/retirar">
            <DatePicker value={dataAgendada} onChange={setDataAgendada} />
          </Field>
          <Field label="Hora" hint="opcional">
            <TimePicker value={horaAgendada} onChange={setHoraAgendada} />
          </Field>
        </div>

        <div>
          <div className="grid grid-cols-2 gap-2">
            {(['retirada', 'entrega'] as DeliveryType[]).map((t) => (
              <button
                key={t}
                onClick={() => setTipoEntrega(t)}
                className={cn(
                  'rounded-xl border px-3 py-2 text-sm font-medium capitalize',
                  tipoEntrega === t ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          {tipoEntrega === 'entrega' && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
              <Field label="Endereço">
                <Input value={endereco} onChange={(e) => setEndereco(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Taxa de entrega">
                <MoneyInput value={taxa} onChange={setTaxa} />
              </Field>
            </div>
          )}
        </div>

        {/* Itens do catálogo (opcional) */}
        {!editing && (
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Itens do catálogo (opcional)</span>
            </div>
            <div className="mb-2">
              <Combobox
                items={(produtos ?? []).map((p) => ({ value: p.id, label: p.nome, hint: formatBRL(p.preco_venda) }))}
                onSelect={(id) => addProduto(id)}
                clearOnSelect
                placeholder="Buscar produto para adicionar…"
              />
            </div>

            {itens.length > 0 && (
              <div className="space-y-2">
                {itens.map((it, idx) => (
                  <div key={it.product_id ?? idx} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{it.product_nome}</span>
                    <div className="w-16">
                      <NumberInput
                        value={it.quantidade}
                        decimais={produtos?.find((p) => p.id === it.product_id)?.unidade === 'kg' ? 3 : 0}
                        onChange={(n) => setItens((prev) => prev.map((x, i) => (i === idx ? { ...x, quantidade: n } : x)))}
                      />
                    </div>
                    <div className="w-28">
                      <MoneyInput
                        value={it.preco_unitario}
                        onChange={(n) => setItens((prev) => prev.map((x, i) => (i === idx ? { ...x, preco_unitario: n } : x)))}
                      />
                    </div>
                    <button
                      onClick={() => setItens((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-slate-300 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-100 pt-2 text-sm">
                  <span className="text-slate-500">Subtotal dos itens</span>
                  <span className="font-semibold tabular">{formatBRL(subtotal)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        <Field label="Descrição da encomenda" hint="ex.: 2.000 salgados sortidos para evento">
          <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Valor total" hint={!editing ? `sugerido: ${formatBRL(sugerido)}` : undefined}>
            <MoneyInput value={total} onChange={(n) => { setTotal(n); setTotalTocado(true) }} />
          </Field>
          <Field label="Previsão de pagamento" hint="para licitação (recebe depois)">
            <div className="flex gap-2">
              <DatePicker value={previsaoPagamento} onChange={setPrevisaoPagamento} className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => setPrevisaoPagamento(hojeMaisDias(20))} className="whitespace-nowrap">
                +20 dias
              </Button>
            </div>
          </Field>
        </div>

        <Field label="Observação" hint="opcional">
          <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
        </Field>

        {editing && <p className="text-xs text-slate-500">Para alterar os itens, cancele e crie uma nova encomenda.</p>}
      </div>
    </Modal>
  )
}
