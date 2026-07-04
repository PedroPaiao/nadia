import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, mensagemErro } from '@/lib/supabase'
import type { Order, OrderItem, OrderStatus, DeliveryType, OrderPaymentMethod } from '@/types/db'

export interface OrderComItens extends Order {
  order_items: OrderItem[]
}

export interface ContaReceber {
  id: string
  cliente_nome: string
  total: number
  data_entrega: string | null
  data_prevista_pagamento: string | null
  vencido: boolean
  dias_para_vencer: number | null
}

export interface EncomendaItemInput {
  product_id?: string | null
  product_nome: string
  quantidade: number
  preco_unitario: number
}

export interface EncomendaInput {
  cliente_nome: string
  items: EncomendaItemInput[]
  total: number
  cliente_whatsapp?: string
  descricao?: string
  observacao?: string
  tipo_entrega: DeliveryType
  endereco?: string
  taxa_entrega?: number
  data_agendada?: string
  hora_agendada?: string
  data_prevista_pagamento?: string
}

export const encomendaKeys = {
  lista: (status?: string) => ['encomendas', 'lista', status ?? 'todas'] as const,
  contasReceber: ['encomendas', 'contas-receber'] as const,
}

export function useEncomendas(status?: OrderStatus | 'ativas') {
  return useQuery({
    queryKey: encomendaKeys.lista(status),
    queryFn: async (): Promise<OrderComItens[]> => {
      let q = supabase
        .from('orders')
        .select('*, order_items(*)')
        .order('data_agendada', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
      if (status === 'ativas') q = q.in('status', ['pendente', 'entregue'])
      else if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw new Error(mensagemErro(error))
      return (data as unknown as OrderComItens[]) ?? []
    },
  })
}

export function useContasReceber() {
  return useQuery({
    queryKey: encomendaKeys.contasReceber,
    queryFn: async (): Promise<ContaReceber[]> => {
      const { data, error } = await supabase.from('vw_contas_receber').select('*')
      if (error) throw new Error(mensagemErro(error))
      return (data as ContaReceber[]) ?? []
    },
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['encomendas'] })
  qc.invalidateQueries({ queryKey: ['relatorios'] })
}

export function useCriarEncomenda() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: EncomendaInput) => {
      const { data, error } = await supabase.rpc('criar_encomenda', {
        p_cliente_nome: input.cliente_nome,
        p_items: input.items,
        p_total: input.total,
        p_cliente_whatsapp: input.cliente_whatsapp ?? null,
        p_descricao: input.descricao ?? null,
        p_observacao: input.observacao ?? null,
        p_tipo_entrega: input.tipo_entrega,
        p_endereco: input.endereco ?? null,
        p_taxa_entrega: input.taxa_entrega ?? 0,
        p_data_agendada: input.data_agendada || null,
        p_hora_agendada: input.hora_agendada || null,
        p_data_prevista_pagamento: input.data_prevista_pagamento || null,
      })
      if (error) throw new Error(mensagemErro(error))
      return data as Order
    },
    onSuccess: () => invalidateAll(qc),
  })
}

export function useAtualizarEncomenda() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: EncomendaInput }) => {
      const { error } = await supabase.rpc('atualizar_encomenda', {
        p_order_id: id,
        p_cliente_nome: input.cliente_nome,
        p_total: input.total,
        p_cliente_whatsapp: input.cliente_whatsapp ?? null,
        p_descricao: input.descricao ?? null,
        p_observacao: input.observacao ?? null,
        p_tipo_entrega: input.tipo_entrega,
        p_endereco: input.endereco ?? null,
        p_taxa_entrega: input.taxa_entrega ?? 0,
        p_data_agendada: input.data_agendada || null,
        p_hora_agendada: input.hora_agendada || null,
        p_data_prevista_pagamento: input.data_prevista_pagamento || null,
      })
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => invalidateAll(qc),
  })
}

export function useMudarStatusEncomenda() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      status: OrderStatus
      forma_pagamento?: OrderPaymentMethod
      data_prevista_pagamento?: string
    }) => {
      const { error } = await supabase.rpc('mudar_status_encomenda', {
        p_order_id: input.id,
        p_status: input.status,
        p_forma_pagamento: input.forma_pagamento ?? null,
        p_data_prevista_pagamento: input.data_prevista_pagamento || null,
      })
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => invalidateAll(qc),
  })
}
