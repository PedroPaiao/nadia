import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, mensagemErro } from '@/lib/supabase'
import type { CashSession, CashMovement, CaixaResumo, CashMovementType } from '@/types/db'

export interface CashSessionComUsuario extends CashSession {
  funcionario: { nome: string } | null
}

export const caixaKeys = {
  aberto: ['caixa', 'aberto'] as const,
  resumo: (id: string) => ['caixa', 'resumo', id] as const,
  movimentos: (id: string) => ['caixa', 'movimentos', id] as const,
  historico: (filtros?: unknown) => ['caixa', 'historico', filtros] as const,
}

/** Sessão de caixa aberta no momento (ou null). */
export function useCaixaAberto() {
  return useQuery({
    queryKey: caixaKeys.aberto,
    queryFn: async (): Promise<CashSessionComUsuario | null> => {
      const { data, error } = await supabase
        .from('cash_sessions')
        .select('*, funcionario:profiles(nome)')
        .eq('status', 'aberto')
        .maybeSingle()
      if (error) throw new Error(mensagemErro(error))
      return (data as unknown as CashSessionComUsuario | null) ?? null
    },
    refetchInterval: 30_000,
  })
}

export function useCaixaResumo(sessionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: caixaKeys.resumo(sessionId ?? 'none'),
    enabled: !!sessionId && enabled,
    queryFn: async (): Promise<CaixaResumo | null> => {
      const { data, error } = await supabase.rpc('caixa_resumo', { p_session_id: sessionId })
      if (error) throw new Error(mensagemErro(error))
      const rows = data as CaixaResumo[]
      return rows?.[0] ?? null
    },
  })
}

export function useMovimentosCaixa(sessionId: string | undefined) {
  return useQuery({
    queryKey: caixaKeys.movimentos(sessionId ?? 'none'),
    enabled: !!sessionId,
    queryFn: async (): Promise<CashMovement[]> => {
      const { data, error } = await supabase
        .from('cash_movements')
        .select('*')
        .eq('cash_session_id', sessionId)
        .order('created_at', { ascending: false })
      if (error) throw new Error(mensagemErro(error))
      return (data as CashMovement[]) ?? []
    },
  })
}

export function useExcluirMovimentoCaixa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('excluir_movimento_caixa', { p_id: id })
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['caixa'] }),
  })
}

export function useAbrirCaixa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { valor_abertura: number; observacao?: string }) => {
      const { data, error } = await supabase.rpc('abrir_caixa', {
        p_valor_abertura: input.valor_abertura,
        p_observacao: input.observacao ?? null,
      })
      if (error) throw new Error(mensagemErro(error))
      return data as CashSession
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['caixa'] }),
  })
}

export function useFecharCaixa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { valor_informado: number; observacao?: string }) => {
      const { data, error } = await supabase.rpc('fechar_caixa', {
        p_valor_informado: input.valor_informado,
        p_observacao: input.observacao ?? null,
      })
      if (error) throw new Error(mensagemErro(error))
      return data as CashSession
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['caixa'] }),
  })
}

export function useRegistrarMovimentoCaixa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { tipo: CashMovementType; valor: number; motivo?: string }) => {
      const { data, error } = await supabase.rpc('registrar_movimento_caixa', {
        p_tipo: input.tipo,
        p_valor: input.valor,
        p_motivo: input.motivo ?? null,
      })
      if (error) throw new Error(mensagemErro(error))
      return data as CashMovement
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['caixa'] }),
  })
}
