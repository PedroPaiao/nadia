import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { CenterSpinner, EmptyState } from '@/components/ui'

/** Exige usuário autenticado com perfil ativo. */
export function RequireAuth() {
  const { session, profile, loading } = useAuth()
  if (loading) return <CenterSpinner label="Carregando…" />
  if (!session || !profile) return <Navigate to="/login" replace />
  return <Outlet />
}

/** Exige papel de administrador. */
export function RequireAdmin() {
  const { profile, loading } = useAuth()
  if (loading) return <CenterSpinner />
  if (profile?.role !== 'admin') {
    return (
      <EmptyState
        title="Acesso restrito"
        description="Esta área é exclusiva da administradora."
      />
    )
  }
  return <Outlet />
}
