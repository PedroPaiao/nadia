import { useState } from 'react'
import { Plus, Trash2, Check, X } from 'lucide-react'
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from './api'
import { Button, Input, Modal, EmptyState } from '@/components/ui'
import { useToast } from '@/components/toast'

export function CategoriasModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const { data: categorias } = useCategories()
  const criar = useCreateCategory()
  const atualizar = useUpdateCategory()
  const remover = useDeleteCategory()

  const [nova, setNova] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editNome, setEditNome] = useState('')

  async function adicionar() {
    if (!nova.trim()) return
    try {
      await criar.mutateAsync({ nome: nova.trim(), ordem: (categorias?.length ?? 0) + 1 })
      setNova('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar categoria.')
    }
  }

  async function salvarEdicao(id: string) {
    const cat = categorias?.find((c) => c.id === id)
    if (!cat) return setEditId(null)
    if (!editNome.trim()) return toast.error('O nome da categoria não pode ficar vazio.')
    try {
      await atualizar.mutateAsync({ id, nome: editNome.trim(), ordem: cat.ordem })
      setEditId(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar.')
    }
  }

  async function excluir(id: string) {
    if (!confirm('Excluir esta categoria? Os produtos ficarão sem categoria.')) return
    try {
      await remover.mutateAsync(id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir.')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Categorias">
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            placeholder="Nova categoria…"
            maxLength={40}
            onKeyDown={(e) => e.key === 'Enter' && adicionar()}
          />
          <Button onClick={adicionar} loading={criar.isPending}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {categorias && categorias.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {categorias.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                {editId === c.id ? (
                  <>
                    <Input value={editNome} onChange={(e) => setEditNome(e.target.value)} className="h-9" maxLength={40} autoFocus />
                    <button onClick={() => salvarEdicao(c.id)} className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={() => setEditId(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      className="flex-1 cursor-pointer text-sm text-slate-800"
                      onClick={() => { setEditId(c.id); setEditNome(c.nome) }}
                    >
                      {c.nome}
                    </span>
                    <button onClick={() => excluir(c.id)} className="rounded-lg p-2 text-red-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nenhuma categoria" description="Adicione categorias para organizar os produtos." />
        )}
      </div>
    </Modal>
  )
}
