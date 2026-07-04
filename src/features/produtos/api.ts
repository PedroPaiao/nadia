import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, mensagemErro } from '@/lib/supabase'
import type { Category, Product, ProductUnit } from '@/types/db'

export const produtoKeys = {
  produtos: (opts?: unknown) => ['produtos', opts] as const,
  categorias: ['categorias'] as const,
}

export interface ProductInput {
  nome: string
  categoria_id: string | null
  preco_venda: number
  custo: number | null
  unidade: ProductUnit
  controla_estoque: boolean
  estoque_minimo: number
  ativo: boolean
}

export function useCategories() {
  return useQuery({
    queryKey: produtoKeys.categorias,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('ordem')
        .order('nome')
      if (error) throw new Error(mensagemErro(error))
      return (data as Category[]) ?? []
    },
  })
}

export function useProducts(opts?: { includeInactive?: boolean }) {
  const includeInactive = opts?.includeInactive ?? false
  return useQuery({
    queryKey: produtoKeys.produtos({ includeInactive }),
    queryFn: async (): Promise<Product[]> => {
      let q = supabase.from('products').select('*').order('nome')
      if (!includeInactive) q = q.eq('ativo', true)
      const { data, error } = await q
      if (error) throw new Error(mensagemErro(error))
      return (data as Product[]) ?? []
    },
  })
}

export function useCreateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ProductInput & { estoque_inicial?: number }) => {
      const { estoque_inicial, ...prod } = input
      const { data, error } = await supabase.from('products').insert(prod).select('*').single()
      if (error) throw new Error(mensagemErro(error))
      const created = data as Product
      if (created.controla_estoque && estoque_inicial && estoque_inicial > 0) {
        const { error: movErr } = await supabase.rpc('registrar_movimento_estoque', {
          p_product_id: created.id,
          p_tipo: 'entrada',
          p_quantidade: estoque_inicial,
          p_motivo: 'Saldo inicial',
        })
        if (movErr) throw new Error(mensagemErro(movErr))
      }
      return created
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['produtos'] })
      qc.invalidateQueries({ queryKey: ['estoque'] })
    },
  })
}

export function useUpdateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ProductInput }) => {
      const { error } = await supabase.from('products').update(input).eq('id', id)
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['produtos'] })
      qc.invalidateQueries({ queryKey: ['estoque'] })
    },
  })
}

// ---------------- Categorias ----------------
export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { nome: string; ordem: number }) => {
      const { error } = await supabase.from('categories').insert(input)
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: produtoKeys.categorias }),
  })
}

export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, nome, ordem }: { id: string; nome: string; ordem: number }) => {
      const { error } = await supabase.from('categories').update({ nome, ordem }).eq('id', id)
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: produtoKeys.categorias }),
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('categories').delete().eq('id', id)
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: produtoKeys.categorias })
      qc.invalidateQueries({ queryKey: ['produtos'] })
    },
  })
}
