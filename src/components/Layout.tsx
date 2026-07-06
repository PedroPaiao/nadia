import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  ShoppingCart,
  Utensils,
  ClipboardList,
  Wallet,
  Package,
  Tags,
  Users,
  BarChart3,
  PiggyBank,
  LogOut,
  ChefHat,
  UserCog,
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { cn } from '@/lib/utils'
import { CaixaStatusBadge } from '@/features/caixa/CaixaStatusBadge'
import { TrocarUsuarioModal } from '@/auth/TrocarUsuarioModal'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  adminOnly?: boolean
}

const NAV: NavItem[] = [
  { to: '/app/pdv', label: 'PDV', icon: ShoppingCart },
  { to: '/app/comandas', label: 'Comandas', icon: Utensils },
  { to: '/app/encomendas', label: 'Encomendas', icon: ClipboardList },
  { to: '/app/caixa', label: 'Caixa', icon: Wallet },
  { to: '/app/estoque', label: 'Estoque', icon: Package },
  { to: '/app/financeiro', label: 'Financeiro', icon: PiggyBank, adminOnly: true },
  { to: '/app/produtos', label: 'Produtos', icon: Tags, adminOnly: true },
  { to: '/app/funcionarios', label: 'Funcionários', icon: Users, adminOnly: true },
  { to: '/app/relatorios', label: 'Relatórios', icon: BarChart3, adminOnly: true },
]

export function Layout() {
  const { profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [trocar, setTrocar] = useState(false)
  const items = NAV.filter((n) => !n.adminOnly || isAdmin)
  const [mais, setMais] = useState(false)

  // No celular, mostra até 5 itens; se houver mais, os 4 primeiros + "Mais".
  const MAX_BARRA = 5
  const barra = items.length > MAX_BARRA ? items.slice(0, MAX_BARRA - 1) : items
  const extras = items.length > MAX_BARRA ? items.slice(MAX_BARRA - 1) : []

  async function handleLogout() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
            <ChefHat className="h-5 w-5" />
          </div>
          <div>
            <p className="font-bold leading-tight text-slate-900">Salgaderia</p>
            <p className="text-xs text-slate-500">PDV & Caixa</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {items.map((item) => (
            <SideLink key={item.to} item={item} />
          ))}
        </nav>

        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 px-2">
            <p className="truncate text-sm font-medium text-slate-800">{profile?.nome}</p>
            <p className="text-xs capitalize text-slate-500">{profile?.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </aside>

      {/* Conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header (mobile + status caixa) */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <ChefHat className="h-5 w-5 text-brand-600" />
            <span className="font-bold text-slate-900">Salgaderia</span>
          </div>
          <div className="hidden md:block" />
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTrocar(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              title="Trocar operador"
            >
              <UserCog className="h-4 w-4" />
              <span className="hidden sm:inline">{profile?.nome?.split(' ')[0] ?? 'Trocar'}</span>
            </button>
            <CaixaStatusBadge />
            <button onClick={handleLogout} className="text-slate-400 hover:text-slate-600 md:hidden">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 pb-24 md:p-6 md:pb-6">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white md:hidden">
        {barra.map((item) => (
          <BottomLink key={item.to} item={item} />
        ))}
        {extras.length > 0 && (
          <button
            onClick={() => setMais(true)}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
              extras.some((e) => location.pathname.startsWith(e.to)) ? 'text-brand-600' : 'text-slate-500',
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            Mais
          </button>
        )}
      </nav>

      {/* Sheet "Mais" (mobile) */}
      {mais && (
        <div className="fixed inset-0 z-50 bg-black/40 md:hidden" onClick={() => setMais(false)}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-6" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200" />
            <div className="grid grid-cols-3 gap-2">
              {extras.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMais(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex flex-col items-center gap-1.5 rounded-xl p-4 text-xs font-medium',
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
                      )
                    }
                  >
                    <Icon className="h-6 w-6" />
                    {item.label}
                  </NavLink>
                )
              })}
              <button
                onClick={() => { setMais(false); handleLogout() }}
                className="flex flex-col items-center gap-1.5 rounded-xl p-4 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                <LogOut className="h-6 w-6" />
                Sair
              </button>
            </div>
          </div>
        </div>
      )}

      {trocar && <TrocarUsuarioModal onClose={() => setTrocar(false)} />}
    </div>
  )
}

function SideLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
        )
      }
    >
      <Icon className="h-5 w-5" />
      {item.label}
    </NavLink>
  )
}

function BottomLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
          isActive ? 'text-brand-600' : 'text-slate-500',
        )
      }
    >
      <Icon className="h-5 w-5" />
      {item.label}
    </NavLink>
  )
}
