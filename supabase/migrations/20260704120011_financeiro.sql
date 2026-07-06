-- =============================================================
-- Financeiro: contas a pagar (despesas), saldos de contas e balanço.
-- Tudo restrito à administradora (dados financeiros do negócio).
-- =============================================================

create type public.expense_category as enum ('fornecedor', 'funcionario', 'aluguel', 'contas', 'impostos', 'boleto', 'outro');
create type public.expense_status   as enum ('pendente', 'pago');

-- ---------- Contas (saldos que a dona mantém: Caixa, Banco...) ----------
create table public.contas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  saldo      numeric(12,2) not null default 0,
  ordem      int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger contas_set_updated_at before update on public.contas
  for each row execute function public.set_updated_at();

-- ---------- Despesas / contas a pagar ----------
create table public.despesas (
  id              uuid primary key default gen_random_uuid(),
  descricao       text not null,
  categoria       public.expense_category not null default 'outro',
  beneficiario    text,                    -- fornecedor / funcionário
  valor           numeric(10,2) not null check (valor >= 0),
  status          public.expense_status not null default 'pendente',
  data_vencimento date,
  data_pagamento  timestamptz,
  forma_pagamento public.order_payment_method,
  conta_id        uuid references public.contas (id),   -- de qual conta saiu (opcional)
  observacao      text,
  funcionario_id  uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index despesas_status_idx on public.despesas (status);
create index despesas_venc_idx on public.despesas (data_vencimento) where status = 'pendente';
create trigger despesas_set_updated_at before update on public.despesas
  for each row execute function public.set_updated_at();

-- ---------- RLS (só admin) ----------
alter table public.contas enable row level security;
alter table public.despesas enable row level security;

create policy contas_admin on public.contas for all using (public.is_admin()) with check (public.is_admin());
create policy despesas_admin on public.despesas for all using (public.is_admin()) with check (public.is_admin());

-- ---------- RPC: pagar despesa (marca paga e abate da conta, se informada) ----------
create or replace function public.pagar_despesa(
  p_id             uuid,
  p_forma          public.order_payment_method default null,
  p_conta_id       uuid default null,
  p_data_pagamento timestamptz default null
)
returns public.despesas
language plpgsql
security definer
set search_path = public
as $$
declare v_d public.despesas;
begin
  if not public.is_admin() then raise exception 'Apenas a administradora.'; end if;

  select * into v_d from public.despesas where id = p_id;
  if not found then raise exception 'Despesa não encontrada.'; end if;
  if v_d.status = 'pago' then raise exception 'Despesa já está paga.'; end if;

  update public.despesas
     set status = 'pago',
         data_pagamento = coalesce(p_data_pagamento, now()),
         forma_pagamento = p_forma,
         conta_id = p_conta_id
   where id = p_id
   returning * into v_d;

  if p_conta_id is not null then
    update public.contas set saldo = saldo - v_d.valor where id = p_conta_id;
  end if;

  return v_d;
end;
$$;

-- ---------- Balanço do período (entradas x saídas) ----------
create or replace function public.financeiro_periodo(
  p_inicio timestamptz,
  p_fim    timestamptz
)
returns table (
  entradas_vendas     numeric,
  entradas_encomendas numeric,
  saidas_despesas     numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Apenas a administradora.'; end if;
  return query
    select
      coalesce((select sum(total) from public.sales
                where status = 'concluida' and created_at >= p_inicio and created_at < p_fim), 0),
      coalesce((select sum(total) from public.orders
                where status = 'pago' and data_pagamento >= p_inicio and data_pagamento < p_fim), 0),
      coalesce((select sum(valor) from public.despesas
                where status = 'pago' and data_pagamento >= p_inicio and data_pagamento < p_fim), 0);
end;
$$;
