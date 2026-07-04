-- =============================================================
-- Funções auxiliares e triggers
-- =============================================================

-- ---------- Helpers de papel/autenticação ----------
-- SECURITY DEFINER para poder ler profiles sem cair na própria RLS (evita recursão).
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role::text from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and ativo
  );
$$;

create or replace function public.is_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and ativo
  );
$$;

-- ---------- updated_at ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------- Aplicar movimento de estoque ----------
-- Antes de inserir, atualiza products.estoque_atual e grava o saldo resultante.
create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
as $$
declare
  v_controla boolean;
  v_novo numeric(12,3);
begin
  select controla_estoque, estoque_atual + new.quantidade
    into v_controla, v_novo
    from public.products
   where id = new.product_id
   for update;

  if not found then
    raise exception 'Produto % não encontrado', new.product_id;
  end if;

  if v_controla then
    update public.products set estoque_atual = v_novo where id = new.product_id;
    new.estoque_apos := v_novo;
  else
    new.estoque_apos := null;
  end if;

  return new;
end;
$$;

create trigger stock_movements_apply
  before insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- ---------- Travas append-only (integridade para auditoria) ----------
-- stock_movements, cash_movements, sale_items: nunca editar nem apagar.
create or replace function public.forbid_update_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Registros de % são imutáveis (append-only) e não podem ser alterados nem removidos.', tg_table_name;
end;
$$;

create trigger stock_movements_immutable
  before update or delete on public.stock_movements
  for each row execute function public.forbid_update_delete();

create trigger cash_movements_immutable
  before update or delete on public.cash_movements
  for each row execute function public.forbid_update_delete();

create trigger sale_items_immutable
  before update or delete on public.sale_items
  for each row execute function public.forbid_update_delete();

-- vendas: só permite a transição concluida -> cancelada; nada mais; nunca apagar.
create or replace function public.guard_sales_update()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Vendas não podem ser apagadas. Use o cancelamento.';
  end if;

  if old.status = 'cancelada' then
    raise exception 'Venda já cancelada não pode ser alterada.';
  end if;

  if new.status = 'cancelada'
     and new.subtotal = old.subtotal
     and new.desconto = old.desconto
     and new.total = old.total
     and new.forma_pagamento = old.forma_pagamento
     and new.funcionario_id = old.funcionario_id
     and new.cash_session_id is not distinct from old.cash_session_id then
    return new; -- cancelamento válido
  end if;

  raise exception 'Vendas são imutáveis; apenas o cancelamento é permitido.';
end;
$$;

create trigger sales_guard
  before update or delete on public.sales
  for each row execute function public.guard_sales_update();

-- caixa: nunca apagar; não alterar depois de fechado.
create or replace function public.guard_cash_sessions()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Sessões de caixa não podem ser apagadas.';
  end if;
  if old.status = 'fechado' then
    raise exception 'Caixa já fechado não pode ser alterado.';
  end if;
  return new;
end;
$$;

create trigger cash_sessions_guard
  before update or delete on public.cash_sessions
  for each row execute function public.guard_cash_sessions();
