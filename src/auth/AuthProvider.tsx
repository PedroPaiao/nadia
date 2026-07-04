import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, usuarioParaEmail, mensagemErro } from '@/lib/supabase'
import type { Profile } from '@/types/db'

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  isAdmin: boolean
  signIn: (usuario: string, senha: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const loadedFor = useRef<string | null>(null)

  async function loadProfile(userId: string) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) {
      console.error('Erro ao carregar perfil:', error)
      setProfile(null)
      return null
    }
    const prof = data as Profile | null
    if (prof && !prof.ativo) {
      // Usuário desativado: encerra a sessão.
      await supabase.auth.signOut()
      setProfile(null)
      return null
    }
    setProfile(prof)
    return prof
  }

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session) {
        loadedFor.current = data.session.user.id
        await loadProfile(data.session.user.id)
      }
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return
      setSession(newSession)
      if (newSession) {
        if (loadedFor.current !== newSession.user.id) {
          loadedFor.current = newSession.user.id
          await loadProfile(newSession.user.id)
        }
      } else {
        loadedFor.current = null
        setProfile(null)
      }
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function signIn(usuario: string, senha: string) {
    const email = usuarioParaEmail(usuario)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) {
      throw new Error('Usuário ou senha inválidos.')
    }
    const prof = await loadProfile(data.user.id)
    if (!prof) {
      throw new Error('Usuário sem acesso ou desativado. Fale com a administradora.')
    }
  }

  async function signOut() {
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.error(mensagemErro(e))
    }
    setProfile(null)
    setSession(null)
  }

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, isAdmin: profile?.role === 'admin', signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return ctx
}
