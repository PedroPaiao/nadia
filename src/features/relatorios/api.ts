import { useQuery } from '@tanstack/react-query'
import { supabase, mensagemErro } from '@/lib/supabase'
import type { CashSession, PaymentMethod, SaleStatus } from '@/types/db'

export interface ResumoVendaRow {
  forma_pagamento: PaymentMethod
  qtd_vendas: number
  total: number
}
export interface ProdutoVendidoRow {
  product_id: string | null
  product_nome: string
  quantidade: number
  total: number
  custo: number
  lucro: number
}

export interface TotaisRow {
  receita: number
  descontos: number
  custo: number
  lucro: number
  qtd_vendas: number
  ticket_medio: number
  canceladas_qtd: number
  canceladas_valor: number
}

export interface VendaDiaRow {
  dia: string
  qtd_vendas: number
  total: number
}
export interface PorFuncionarioRow {
  funcionario_id: string
  nome: string
  qtd_vendas: number
  total: number
}
export interface HistoricoCaixaRow extends CashSession {
  funcionario: { nome: string } | null
}
export interface VendaSessaoRow {
  id: string
  created_at: string
  forma_pagamento: PaymentMethod
  total: number
  status: SaleStatus
  cliente_nome: string | null
  funcionario: { nome: string } | null
}

export const relatorioKeys = {
  totais: (i: string, f: string) => ['relatorios', 'totais', i, f] as const,
  porDia: (i: string, f: string) => ['relatorios', 'por-dia', i, f] as const,
  resumo: (i: string, f: string) => ['relatorios', 'resumo', i, f] as const,
  produtos: (i: string, f: string) => ['relatorios', 'produtos', i, f] as const,
  funcionarios: (i: string, f: string) => ['relatorios', 'funcionarios', i, f] as const,
  historicoCaixa: (i: string, f: string) => ['relatorios', 'historico-caixa', i, f] as const,
  vendasSessao: (id: string) => ['relatorios', 'vendas-sessao', id] as const,
}

export function useTotais(inicio: string, fim: string) {
  return useQuery({
    queryKey: relatorioKeys.totais(inicio, fim),
    queryFn: async (): Promise<TotaisRow> => {
      const { data, error } = await supabase.rpc('relatorio_totais', { p_inicio: inicio, p_fim: fim })
      if (error) throw new Error(mensagemErro(error))
      const rows = data as TotaisRow[]
      return rows?.[0] ?? {
        receita: 0, descontos: 0, custo: 0, lucro: 0,
        qtd_vendas: 0, ticket_medio: 0, canceladas_qtd: 0, canceladas_valor: 0,
      }
    },
  })
}

export function useVendasPorDia(inicio: string, fim: string) {
  return useQuery({
    queryKey: relatorioKeys.porDia(inicio, fim),
    queryFn: async (): Promise<VendaDiaRow[]> => {
      const { data, error } = await supabase.rpc('relatorio_vendas_por_dia', { p_inicio: inicio, p_fim: fim })
      if (error) throw new Error(mensagemErro(error))
      return (data as VendaDiaRow[]) ?? []
    },
  })
}

export function useResumoVendas(inicio: string, fim: string) {
  return useQuery({
    queryKey: relatorioKeys.resumo(inicio, fim),
    queryFn: async (): Promise<ResumoVendaRow[]> => {
      const { data, error } = await supabase.rpc('relatorio_vendas_resumo', { p_inicio: inicio, p_fim: fim })
      if (error) throw new Error(mensagemErro(error))
      return (data as ResumoVendaRow[]) ?? []
    },
  })
}

export function useProdutosVendidos(inicio: string, fim: string) {
  return useQuery({
    queryKey: relatorioKeys.produtos(inicio, fim),
    queryFn: async (): Promise<ProdutoVendidoRow[]> => {
      const { data, error } = await supabase.rpc('relatorio_produtos_vendidos', {
        p_inicio: inicio,
        p_fim: fim,
        p_limite: 20,
      })
      if (error) throw new Error(mensagemErro(error))
      return (data as ProdutoVendidoRow[]) ?? []
    },
  })
}

export function usePorFuncionario(inicio: string, fim: string) {
  return useQuery({
    queryKey: relatorioKeys.funcionarios(inicio, fim),
    queryFn: async (): Promise<PorFuncionarioRow[]> => {
      const { data, error } = await supabase.rpc('relatorio_por_funcionario', { p_inicio: inicio, p_fim: fim })
      if (error) throw new Error(mensagemErro(error))
      return (data as PorFuncionarioRow[]) ?? []
    },
  })
}

export function useHistoricoCaixa(inicio: string, fim: string) {
  return useQuery({
    queryKey: relatorioKeys.historicoCaixa(inicio, fim),
    queryFn: async (): Promise<HistoricoCaixaRow[]> => {
      const { data, error } = await supabase
        .from('cash_sessions')
        .select('*, funcionario:profiles(nome)')
        .gte('aberto_em', inicio)
        .lt('aberto_em', fim)
        .order('aberto_em', { ascending: false })
      if (error) throw new Error(mensagemErro(error))
      return (data as unknown as HistoricoCaixaRow[]) ?? []
    },
  })
}

export function useVendasSessao(sessionId: string | undefined) {
  return useQuery({
    queryKey: relatorioKeys.vendasSessao(sessionId ?? 'none'),
    enabled: !!sessionId,
    queryFn: async (): Promise<VendaSessaoRow[]> => {
      const { data, error } = await supabase
        .from('sales')
        .select('id, created_at, forma_pagamento, total, status, cliente_nome, funcionario:profiles(nome)')
        .eq('cash_session_id', sessionId)
        .order('created_at', { ascending: false })
      if (error) throw new Error(mensagemErro(error))
      return (data as unknown as VendaSessaoRow[]) ?? []
    },
  })
}
