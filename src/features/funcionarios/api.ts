import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, mensagemErro } from '@/lib/supabase'
import type { Profile, UserRole } from '@/types/db'

export const funcionarioKeys = { lista: ['funcionarios'] as const }

export function useFuncionarios() {
  return useQuery({
    queryKey: funcionarioKeys.lista,
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase.from('profiles').select('*').order('nome')
      if (error) throw new Error(mensagemErro(error))
      return (data as Profile[]) ?? []
    },
  })
}

export function useCriarFuncionario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { usuario: string; senha: string; nome: string; role: UserRole }) => {
      const { data, error } = await supabase.rpc('admin_criar_usuario', {
        p_usuario: input.usuario,
        p_senha: input.senha,
        p_nome: input.nome,
        p_role: input.role,
      })
      if (error) throw new Error(mensagemErro(error))
      return data as Profile
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: funcionarioKeys.lista }),
  })
}

export function useResetarSenha() {
  return useMutation({
    mutationFn: async (input: { user_id: string; senha: string }) => {
      const { error } = await supabase.rpc('admin_resetar_senha', {
        p_user_id: input.user_id,
        p_senha: input.senha,
      })
      if (error) throw new Error(mensagemErro(error))
    },
  })
}

export function useAtualizarFuncionario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; nome?: string; role?: UserRole; ativo?: boolean }) => {
      const { id, ...campos } = input
      const { error } = await supabase.from('profiles').update(campos).eq('id', id)
      if (error) throw new Error(mensagemErro(error))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: funcionarioKeys.lista }),
  })
}
