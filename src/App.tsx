import { Routes, Route, Navigate } from 'react-router-dom'
import { RequireAuth, RequireAdmin } from '@/auth/guards'
import { LoginPage } from '@/auth/LoginPage'
import { Layout } from '@/components/Layout'
import { PDVPage } from '@/features/pdv/PDVPage'
import { ComandasPage } from '@/features/comandas/ComandasPage'
import { EncomendasPage } from '@/features/encomendas/EncomendasPage'
import { CaixaPage } from '@/features/caixa/CaixaPage'
import { EstoquePage } from '@/features/estoque/EstoquePage'
import { ProdutosPage } from '@/features/produtos/ProdutosPage'
import { FuncionariosPage } from '@/features/funcionarios/FuncionariosPage'
import { RelatoriosPage } from '@/features/relatorios/RelatoriosPage'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/app" element={<Layout />}>
          <Route index element={<Navigate to="/app/pdv" replace />} />
          <Route path="pdv" element={<PDVPage />} />
          <Route path="comandas" element={<ComandasPage />} />
          <Route path="encomendas" element={<EncomendasPage />} />
          <Route path="caixa" element={<CaixaPage />} />
          <Route path="estoque" element={<EstoquePage />} />

          <Route element={<RequireAdmin />}>
            <Route path="produtos" element={<ProdutosPage />} />
            <Route path="funcionarios" element={<FuncionariosPage />} />
            <Route path="relatorios" element={<RelatoriosPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  )
}
