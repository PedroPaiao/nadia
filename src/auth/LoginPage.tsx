import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ChefHat } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { Button, Field, Input, CenterSpinner } from '@/components/ui'
import { useToast } from '@/components/toast'

export function LoginPage() {
  const { session, profile, loading, signIn } = useAuth()
  const toast = useToast()
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (loading) return <CenterSpinner label="Carregando…" />
  if (session && profile) return <Navigate to="/app" replace />

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!usuario.trim() || !senha.trim()) {
      toast.error('Preencha usuário e senha.')
      return
    }
    setSubmitting(true)
    try {
      await signIn(usuario, senha)
      // A navegação acontece pelo redirect acima quando o perfil carrega.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível entrar.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
            <ChefHat className="h-9 w-9" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Salgaderia</h1>
          <p className="text-sm text-slate-500">Sistema de vendas e caixa</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Usuário">
            <Input
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="ex.: maria"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
            />
          </Field>
          <Field label="Senha">
            <Input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="••••••"
              autoComplete="current-password"
            />
          </Field>
          <Button type="submit" size="lg" loading={submitting} className="w-full">
            Entrar
          </Button>
        </form>
      </div>
    </div>
  )
}
