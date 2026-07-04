-- =============================================================
-- Troca rápida de usuário no balcão.
-- Qualquer usuário ATIVO passa a enxergar a lista de perfis (para trocar
-- de operador e para mostrar nomes em comandas/caixa). A troca em si é feita
-- por re-login (a senha de cada conta continua protegendo o acesso).
-- =============================================================

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_ativo());
