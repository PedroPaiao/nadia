import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, mensagemErro } from '@/lib/supabase'
import type { Conta, Despesa, ExpenseCategory, ExpenseStatus, OrderPaymentMethod } from '@/types/db'

// ---------------- Contas (saldos) ----------------
export function useContas() {
  return useQuery({
    queryKey: ['financeiro', 'contas'],
    queryFn: async (): Promise<Conta[]> => {
      const { data, error } = await supabase.from('contas').select('*').order('ordem').order('nome')
      if (error) throw new Error(mensagemErro(error))
      return (data as Conta[]) ?? []
    },
  })
}

export function useSalvarConta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id?: string; nome: string; saldo: number; ordem?: number }) => {
      if (input.id) {
        const { error } = await supabase.from('contas').update({ nome: input.nome, saldo: input.saldo }).eq('id', input.id)
        if (error) throw new Error(mensagemErro(error))
      } else {
        const { error } = await supabase.from('contas').insert({ nome: input.nome, saldo: input.saldo, ordem: input.ordem ?? 0 })
        if (error) throw new Error(mensagemErro(error))
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['financeiro'] }),
  })
}

export function useExcluirConta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contas').delete().eq('id', id)
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['financeiro'] }),
  })
}

// ---------------- Despesas / contas a pagar ----------------
export interface DespesasPagina {
  rows: Despesa[]
  total: number
}

export function useDespesas(status?: ExpenseStatus, limite = 30) {
  return useQuery({
    queryKey: ['financeiro', 'despesas', status ?? 'todas', limite],
    queryFn: async (): Promise<DespesasPagina> => {
      let q = supabase
        .from('despesas')
        .select('*', { count: 'exact' })
        .order('data_vencimento', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limite)
      if (status) q = q.eq('status', status)
      const { data, error, count } = await q
      if (error) throw new Error(mensagemErro(error))
      return { rows: (data as Despesa[]) ?? [], total: count ?? 0 }
    },
  })
}

/** Total pendente a pagar + quantos vencidos (para o aviso). */
export function useTotalAPagar() {
  return useQuery({
    queryKey: ['financeiro', 'a-pagar'],
    queryFn: async (): Promise<{ total: number; qtd: number; vencidos: number }> => {
      const { data, error } = await supabase
        .from('despesas')
        .select('valor, data_vencimento')
        .eq('status', 'pendente')
      if (error) throw new Error(mensagemErro(error))
      const hoje = new Date().toISOString().slice(0, 10)
      const rows = (data as { valor: number; data_vencimento: string | null }[]) ?? []
      return {
        total: rows.reduce((a, d) => a + Number(d.valor), 0),
        qtd: rows.length,
        vencidos: rows.filter((d) => d.data_vencimento && d.data_vencimento < hoje).length,
      }
    },
  })
}

export interface DespesaInput {
  descricao: string
  categoria: ExpenseCategory
  beneficiario?: string
  valor: number
  data_vencimento?: string
  observacao?: string
}

export function useSalvarDespesa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: DespesaInput }) => {
      const payload = {
        descricao: input.descricao,
        categoria: input.categoria,
        beneficiario: input.beneficiario || null,
        valor: input.valor,
        data_vencimento: input.data_vencimento || null,
        observacao: input.observacao || null,
      }
      if (id) {
        const { error } = await supabase.from('despesas').update(payload).eq('id', id)
        if (error) throw new Error(mensagemErro(error))
      } else {
        const { error } = await supabase.from('despesas').insert(payload)
        if (error) throw new Error(mensagemErro(error))
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['financeiro'] }),
  })
}

export function usePagarDespesa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; forma?: OrderPaymentMethod; conta_id?: string }) => {
      const { error } = await supabase.rpc('pagar_despesa', {
        p_id: input.id,
        p_forma: input.forma ?? null,
        p_conta_id: input.conta_id || null,
      })
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['financeiro'] }),
  })
}

export function useExcluirDespesa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('despesas').delete().eq('id', id)
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['financeiro'] }),
  })
}

// ---------------- Balanço do período ----------------
export interface FinanceiroPeriodoRow {
  entradas_vendas: number
  entradas_encomendas: number
  saidas_despesas: number
}

export function useFinanceiroPeriodo(inicio: string, fim: string) {
  return useQuery({
    queryKey: ['financeiro', 'periodo', inicio, fim],
    queryFn: async (): Promise<FinanceiroPeriodoRow> => {
      const { data, error } = await supabase.rpc('financeiro_periodo', { p_inicio: inicio, p_fim: fim })
      if (error) throw new Error(mensagemErro(error))
      const r = (data as FinanceiroPeriodoRow[])?.[0]
      return r ?? { entradas_vendas: 0, entradas_encomendas: 0, saidas_despesas: 0 }
    },
  })
}
