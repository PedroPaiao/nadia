import { createClient } from '@supabase/supabase-js'
import { normalizeUsuario } from './utils'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error(
    'Configuração ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env.local',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

/** Domínio sintético usado internamente para o login por usuário. */
export const USER_EMAIL_DOMAIN = '@salgaderia.local'

/** Converte o login digitado ("maria") no e-mail interno ("maria@salgaderia.local"). */
export function usuarioParaEmail(usuario: string): string {
  return `${normalizeUsuario(usuario)}${USER_EMAIL_DOMAIN}`
}

/** Extrai uma mensagem legível de erros do Supabase/Postgres. */
export function mensagemErro(err: unknown): string {
  if (!err) return 'Erro desconhecido.'
  if (typeof err === 'string') return err
  const anyErr = err as { message?: string; error_description?: string; details?: string }
  return anyErr.message || anyErr.error_description || anyErr.details || 'Ocorreu um erro.'
}
