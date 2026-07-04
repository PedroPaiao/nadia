import { useState } from 'react'
import { ShieldCheck, User } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { useFuncionarios } from '@/features/funcionarios/api'
import type { Profile } from '@/types/db'
import { Button, Field, Input, Modal, Badge, CenterSpinner } from '@/components/ui'
import { useToast } from '@/components/toast'
import { cn } from '@/lib/utils'

/** Troca rápida de operador: funcionário usa a senha rápida; a dona usa a senha forte. */
export function TrocarUsuarioModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const { signIn, profile } = useAuth()
  const { data: usuarios, isLoading } = useFuncionarios()
  const [sel, setSel] = useState<Profile | null>(null)
  const [senha, setSenha] = useState('')
  const [loading, setLoading] = useState(false)

  const ativos = (usuarios ?? []).filter((u) => u.ativo)

  function escolher(u: Profile) {
    setSel(u)
    // Funcionário: pré-preenche a senha rápida. Dona/admin: exige digitar a senha forte.
    setSenha(u.role === 'admin' ? '' : '123456')
  }

  async function trocar() {
    if (!sel) return
    if (!senha) return toast.error('Informe a senha.')
    setLoading(true)
    try {
      await signIn(sel.usuario, senha)
      toast.success(`Operador: ${sel.nome}`)
      onClose()
    } catch {
      toast.error(sel.role === 'admin' ? 'Senha da administradora incorreta.' : 'Senha incorreta.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open onClose={onClose} title="Trocar operador"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={trocar} loading={loading} disabled={!sel}>Entrar</Button>
        </>
      }
    >
      {isLoading ? (
        <CenterSpinner />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2">
            {ativos.map((u) => {
              const atual = u.id === profile?.id
              return (
                <button
                  key={u.id}
                  onClick={() => escolher(u)}
                  disabled={atual}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left',
                    sel?.id === u.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50',
                    atual && 'opacity-50',
                  )}
                >
                  <span className={cn('flex h-9 w-9 items-center justify-center rounded-full', u.role === 'admin' ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-500')}>
                    {u.role === 'admin' ? <ShieldCheck className="h-5 w-5" /> : <User className="h-5 w-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{u.nome}</span>
                    <span className="block text-xs text-slate-400">@{u.usuario}</span>
                  </span>
                  {u.role === 'admin' && <Badge tone="brand">Dona</Badge>}
                  {atual && <Badge tone="gray">Atual</Badge>}
                </button>
              )
            })}
          </div>

          {sel && (
            <Field
              label={sel.role === 'admin' ? 'Senha da administradora' : 'Senha'}
              hint={sel.role === 'admin' ? 'a senha forte da dona' : 'senha rápida do balcão'}
            >
              <Input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && trocar()}
              />
            </Field>
          )}
        </div>
      )}
    </Modal>
  )
}
