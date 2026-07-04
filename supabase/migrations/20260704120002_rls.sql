-- =============================================================
-- Row Level Security
-- Escritas de venda/estoque/caixa passam por RPC (SECURITY DEFINER),
-- então aqui definimos principalmente as regras de LEITURA e o CRUD de cadastros.
-- =============================================================

alter table public.profiles       enable row level security;
alter table public.categories     enable row level security;
alter table public.products       enable row level security;
alter table public.stock_movements enable row level security;
alter table public.cash_sessions  enable row level security;
alter table public.cash_movements enable row level security;
alter table public.sales          enable row level security;
alter table public.sale_items     enable row level security;

-- ---------- profiles ----------
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy profiles_admin_insert on public.profiles
  for insert with check (public.is_admin());

create policy profiles_admin_update on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- ---------- categories ----------
create policy categories_select on public.categories
  for select using (public.is_ativo());

create policy categories_admin_write on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- products ----------
create policy products_select on public.products
  for select using (public.is_ativo());

create policy products_admin_write on public.products
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- stock_movements (leitura; escrita via RPC/trigger) ----------
create policy stock_movements_select on public.stock_movements
  for select using (public.is_ativo());

-- ---------- cash_sessions ----------
-- O caixa é único e compartilhado no balcão: todos os ativos veem o caixa ABERTO.
-- Histórico (fechados) só o dono e o admin.
create policy cash_sessions_select on public.cash_sessions
  for select using (
    public.is_admin()
    or funcionario_id = auth.uid()
    or (status = 'aberto' and public.is_ativo())
  );

-- ---------- cash_movements ----------
create policy cash_movements_select on public.cash_movements
  for select using (
    public.is_admin()
    or usuario_id = auth.uid()
    or exists (
      select 1 from public.cash_sessions cs
      where cs.id = cash_session_id
        and (cs.funcionario_id = auth.uid() or (cs.status = 'aberto' and public.is_ativo()))
    )
  );

-- ---------- sales ----------
create policy sales_select on public.sales
  for select using (public.is_admin() or funcionario_id = auth.uid());

-- ---------- sale_items ----------
create policy sale_items_select on public.sale_items
  for select using (
    exists (
      select 1 from public.sales s
      where s.id = sale_id and (public.is_admin() or s.funcionario_id = auth.uid())
    )
  );
