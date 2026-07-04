import { useState } from 'react'
import { Plus, KeyRound, UserCog } from 'lucide-react'
import { useFuncionarios, useCriarFuncionario, useResetarSenha, useAtualizarFuncionario } from './api'
import type { Profile, UserRole } from '@/types/db'
import { Button, Card, CenterSpinner, EmptyState, Input, Field, Select, Badge, Modal } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useAuth } from '@/auth/AuthProvider'
import { normalizeUsuario } from '@/lib/utils'

export function FuncionariosPage() {
  const { data: funcionarios, isLoading } = useFuncionarios()
  const [criando, setCriando] = useState(false)
  const [resetando, setResetando] = useState<Profile | null>(null)
  const [editando, setEditando] = useState<Profile | null>(null)

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Funcionários</h1>
        <Button onClick={() => setCriando(true)}>
          <Plus className="h-4 w-4" /> Novo funcionário
        </Button>
      </div>

      {isLoading ? (
        <CenterSpinner />
      ) : !funcionarios || funcionarios.length === 0 ? (
        <Card><EmptyState title="Nenhum funcionário" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Usuário</th>
                  <th className="px-4 py-3">Papel</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {funcionarios.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{f.nome}</td>
                    <td className="px-4 py-3 text-slate-600">{f.usuario}</td>
                    <td className="px-4 py-3">
                      {f.role === 'admin' ? <Badge tone="brand">Administradora</Badge> : <Badge tone="blue">Funcionário</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      {f.ativo ? <Badge tone="green">Ativo</Badge> : <Badge tone="gray">Inativo</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setEditando(f)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Editar">
                          <UserCog className="h-4 w-4" />
                        </button>
                        <button onClick={() => setResetando(f)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Redefinir senha">
                          <KeyRound className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {criando && <CriarFuncionarioModal onClose={() => setCriando(false)} />}
      {resetando && <ResetSenhaModal funcionario={resetando} onClose={() => setResetando(null)} />}
      {editando && <EditarFuncionarioModal funcionario={editando} onClose={() => setEditando(null)} />}
    </div>
  )
}

function CriarFuncionarioModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const criar = useCriarFuncionario()
  const [nome, setNome] = useState('')
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [role, setRole] = useState<UserRole>('funcionario')

  async function salvar() {
    if (!nome.trim() || !usuario.trim() || !senha) {
      toast.error('Preencha nome, usuário e senha.')
      return
    }
    if (senha.length < 4) {
      toast.error('A senha deve ter ao menos 4 caracteres.')
      return
    }
    try {
      await criar.mutateAsync({ nome: nome.trim(), usuario, senha, role })
      toast.success('Funcionário criado.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar.')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Novo funcionário"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} loading={criar.isPending}>Criar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome completo">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} autoFocus />
        </Field>
        <Field label="Usuário (login)" hint="minúsculas, sem espaços/acentos; ex.: maria">
          <Input
            value={usuario}
            onChange={(e) => setUsuario(normalizeUsuario(e.target.value))}
            autoCapitalize="none"
            autoCorrect="off"
            maxLength={30}
          />
        </Field>
        <Field label="Senha" hint="mínimo 4 caracteres">
          <Input type="text" value={senha} onChange={(e) => setSenha(e.target.value)} maxLength={40} />
        </Field>
        <Field label="Papel">
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="funcionario">Funcionário (balcão)</option>
            <option value="admin">Administradora (acesso total)</option>
          </Select>
        </Field>
      </div>
    </Modal>
  )
}

function ResetSenhaModal({ funcionario, onClose }: { funcionario: Profile; onClose: () => void }) {
  const toast = useToast()
  const reset = useResetarSenha()
  const [senha, setSenha] = useState('')

  async function salvar() {
    if (!senha.trim()) return toast.error('Informe a nova senha.')
    if (senha.length < 4) return toast.error('A senha deve ter ao menos 4 caracteres.')
    try {
      await reset.mutateAsync({ user_id: funcionario.id, senha })
      toast.success('Senha redefinida.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Redefinir senha — ${funcionario.nome}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} loading={reset.isPending}>Salvar</Button>
        </>
      }
    >
      <Field label="Nova senha" hint="mínimo 4 caracteres">
        <Input type="text" value={senha} onChange={(e) => setSenha(e.target.value)} maxLength={40} autoFocus />
      </Field>
    </Modal>
  )
}

function EditarFuncionarioModal({ funcionario, onClose }: { funcionario: Profile; onClose: () => void }) {
  const toast = useToast()
  const { profile } = useAuth()
  const atualizar = useAtualizarFuncionario()
  const [nome, setNome] = useState(funcionario.nome)
  const [role, setRole] = useState<UserRole>(funcionario.role)
  const [ativo, setAtivo] = useState(funcionario.ativo)
  const ehVoceMesmo = profile?.id === funcionario.id

  async function salvar() {
    if (!nome.trim()) return toast.error('Informe o nome.')
    try {
      await atualizar.mutateAsync({ id: funcionario.id, nome: nome.trim(), role, ativo })
      toast.success('Funcionário atualizado.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Editar — ${funcionario.nome}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} loading={atualizar.isPending}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Papel">
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={ehVoceMesmo}>
            <option value="funcionario">Funcionário (balcão)</option>
            <option value="admin">Administradora (acesso total)</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
            disabled={ehVoceMesmo}
            className="h-4 w-4 rounded border-slate-300"
          />
          Ativo (pode entrar no sistema)
        </label>
        {ehVoceMesmo && <p className="text-xs text-slate-500">Você não pode alterar o próprio papel ou desativar a si mesma.</p>}
      </div>
    </Modal>
  )
}
