import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, mensagemErro } from '@/lib/supabase'
import type { PaymentMethod, Sale } from '@/types/db'

export interface VendaItemInput {
  product_id: string
  quantidade: number
}

export interface MaisVendidoRow {
  product_id: string
  quantidade: number
}

/** Campeões de venda da loja inteira (para o atalho "Mais vendidos" do PDV). */
export function useMaisVendidos(limite = 8, dias = 90) {
  return useQuery({
    queryKey: ['pdv', 'mais-vendidos', limite, dias],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<MaisVendidoRow[]> => {
      const { data, error } = await supabase.rpc('produtos_mais_vendidos', { p_limite: limite, p_dias: dias })
      if (error) throw new Error(mensagemErro(error))
      return (data as MaisVendidoRow[]) ?? []
    },
  })
}

export function useRegistrarVenda() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      items: VendaItemInput[]
      forma_pagamento: PaymentMethod
      desconto: number
      cliente_nome?: string
      valor_recebido?: number | null
    }): Promise<Sale> => {
      const { data, error } = await supabase.rpc('registrar_venda', {
        p_items: input.items,
        p_forma_pagamento: input.forma_pagamento,
        p_desconto: input.desconto,
        p_cliente_nome: input.cliente_nome ?? null,
        p_valor_recebido: input.valor_recebido ?? null,
      })
      if (error) throw new Error(mensagemErro(error))
      return data as Sale
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['produtos'] })
      qc.invalidateQueries({ queryKey: ['estoque'] })
      qc.invalidateQueries({ queryKey: ['caixa'] })
      qc.invalidateQueries({ queryKey: ['relatorios'] })
    },
  })
}
