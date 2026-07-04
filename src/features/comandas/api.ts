import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, mensagemErro } from '@/lib/supabase'
import type { Comanda, ComandaItem, PaymentMethod, Sale } from '@/types/db'

export interface ComandaComItens extends Comanda {
  comanda_items: ComandaItem[]
}

export const comandaKeys = {
  abertas: ['comandas', 'abertas'] as const,
}

export function useComandasAbertas() {
  return useQuery({
    queryKey: comandaKeys.abertas,
    queryFn: async (): Promise<ComandaComItens[]> => {
      const { data, error } = await supabase
        .from('comandas')
        .select('*, comanda_items(*)')
        .eq('status', 'aberta')
        .order('aberta_em', { ascending: true })
      if (error) throw new Error(mensagemErro(error))
      return (data as unknown as ComandaComItens[]) ?? []
    },
    refetchInterval: 20_000,
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['comandas'] })
  qc.invalidateQueries({ queryKey: ['produtos'] })
  qc.invalidateQueries({ queryKey: ['estoque'] })
  qc.invalidateQueries({ queryKey: ['caixa'] })
  qc.invalidateQueries({ queryKey: ['relatorios'] })
}

export function useAbrirComanda() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (nome: string) => {
      const { data, error } = await supabase.rpc('abrir_comanda', { p_nome: nome })
      if (error) throw new Error(mensagemErro(error))
      return data as Comanda
    },
    onSuccess: () => invalidate(qc),
  })
}

export function useAdicionarItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { comanda_id: string; product_id: string; quantidade: number }) => {
      const { error } = await supabase.rpc('adicionar_item_comanda', {
        p_comanda_id: input.comanda_id,
        p_product_id: input.product_id,
        p_quantidade: input.quantidade,
      })
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => invalidate(qc),
  })
}

export function useRemoverItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.rpc('remover_item_comanda', { p_item_id: itemId })
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => invalidate(qc),
  })
}

export function useFecharComanda() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      comanda_id: string
      forma_pagamento: PaymentMethod
      desconto: number
      valor_recebido?: number | null
    }): Promise<Sale> => {
      const { data, error } = await supabase.rpc('fechar_comanda', {
        p_comanda_id: input.comanda_id,
        p_forma_pagamento: input.forma_pagamento,
        p_desconto: input.desconto,
        p_valor_recebido: input.valor_recebido ?? null,
      })
      if (error) throw new Error(mensagemErro(error))
      return data as Sale
    },
    onSuccess: () => invalidate(qc),
  })
}

export function useCancelarComanda() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (comandaId: string) => {
      const { error } = await supabase.rpc('cancelar_comanda', { p_comanda_id: comandaId })
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => invalidate(qc),
  })
}
