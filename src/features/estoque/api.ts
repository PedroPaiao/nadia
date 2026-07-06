import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, mensagemErro } from '@/lib/supabase'
import type { MovementType, ProductUnit } from '@/types/db'

export interface StockMovementRow {
  id: string
  product_id: string
  tipo: MovementType
  quantidade: number
  estoque_apos: number | null
  motivo: string | null
  created_at: string
  products: { nome: string; unidade: ProductUnit } | null
  profiles: { nome: string } | null
}

export interface EstoqueBaixoRow {
  id: string
  nome: string
  unidade: ProductUnit
  estoque_atual: number
  estoque_minimo: number
  categoria: string | null
}

export const estoqueKeys = {
  movimentos: (productId?: string, limite?: number) => ['estoque', 'movimentos', productId ?? 'all', limite ?? 0] as const,
  baixo: ['estoque', 'baixo'] as const,
}

export interface MovimentosPagina {
  rows: StockMovementRow[]
  total: number
}

export function useMovimentosEstoque(productId?: string, limite = 50) {
  return useQuery({
    queryKey: estoqueKeys.movimentos(productId, limite),
    queryFn: async (): Promise<MovimentosPagina> => {
      let q = supabase
        .from('stock_movements')
        .select('id, product_id, tipo, quantidade, estoque_apos, motivo, created_at, products(nome, unidade), profiles(nome)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(limite)
      if (productId) q = q.eq('product_id', productId)
      const { data, error, count } = await q
      if (error) throw new Error(mensagemErro(error))
      return { rows: (data as unknown as StockMovementRow[]) ?? [], total: count ?? 0 }
    },
  })
}

export function useEstoqueBaixo() {
  return useQuery({
    queryKey: estoqueKeys.baixo,
    queryFn: async (): Promise<EstoqueBaixoRow[]> => {
      const { data, error } = await supabase.from('vw_estoque_baixo').select('*')
      if (error) throw new Error(mensagemErro(error))
      return (data as EstoqueBaixoRow[]) ?? []
    },
  })
}

export function useExcluirMovimento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('excluir_movimento_estoque', { p_id: id })
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['estoque'] })
      qc.invalidateQueries({ queryKey: ['produtos'] })
    },
  })
}

export function useRegistrarMovimento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { product_id: string; tipo: MovementType; quantidade: number; motivo?: string }) => {
      const { error } = await supabase.rpc('registrar_movimento_estoque', {
        p_product_id: input.product_id,
        p_tipo: input.tipo,
        p_quantidade: input.quantidade,
        p_motivo: input.motivo ?? null,
      })
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['estoque'] })
      qc.invalidateQueries({ queryKey: ['produtos'] })
    },
  })
}
