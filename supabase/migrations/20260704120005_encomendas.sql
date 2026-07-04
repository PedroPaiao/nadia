-- =============================================================
-- Encomendas / Pedidos agendados (com contas a receber)
-- Status: pendente -> entregue -> pago (e cancelado).
-- Ficam SEPARADAS do caixa diário e NÃO baixam estoque (produção sob demanda).
-- =============================================================

create type public.order_status         as enum ('pendente', 'entregue', 'pago', 'cancelado');
create type public.order_origin         as enum ('balcao', 'online');
create type public.delivery_type        as enum ('retirada', 'entrega');
create type public.order_payment_method as enum ('dinheiro', 'pix', 'debito', 'credito', 'transferencia', 'boleto', 'outro');

create table public.orders (
  id                      uuid primary key default gen_random_uuid(),
  origem                  public.order_origin not null default 'balcao',
  cliente_nome            text not null,
  cliente_whatsapp        text,
  descricao               text,
  observacao              text,
  tipo_entrega            public.delivery_type not null default 'retirada',
  endereco                text,
  taxa_entrega            numeric(10,2) not null default 0 check (taxa_entrega >= 0),
  subtotal                numeric(10,2) not null default 0 check (subtotal >= 0),
  total                   numeric(10,2) not null default 0 check (total >= 0),
  status                  public.order_status not null default 'pendente',
  data_agendada           date,
  hora_agendada           time,
  data_prevista_pagamento date,
  data_entrega            timestamptz,
  data_pagamento          timestamptz,
  forma_pagamento         public.order_payment_method,
  funcionario_id          uuid references public.profiles (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index orders_status_idx on public.orders (status);
create index orders_data_agendada_idx on public.orders (data_agendada);
create index orders_prev_pag_idx on public.orders (data_prevista_pagamento) where status = 'entregue';

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders (id) on delete cascade,
  product_id     uuid references public.products (id),
  product_nome   text not null,
  quantidade     numeric(12,3) not null check (quantidade > 0),
  preco_unitario numeric(10,2) not null check (preco_unitario >= 0),
  subtotal       numeric(10,2) not null check (subtotal >= 0)
);
create index order_items_order_idx on public.order_items (order_id);

-- ---------------- RLS ----------------
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Encomendas são dados operacionais compartilhados: todo funcionário ativo enxerga.
create policy orders_select on public.orders
  for select using (public.is_ativo());

create policy order_items_select on public.order_items
  for select using (
    exists (select 1 from public.orders o where o.id = order_id and public.is_ativo())
  );

-- ---------------- RPC ----------------
-- p_items: jsonb [{ "product_id"?, "product_nome", "quantidade", "preco_unitario" }, ...]
create or replace function public.criar_encomenda(
  p_cliente_nome            text,
  p_items                   jsonb default '[]'::jsonb,
  p_total                   numeric default null,
  p_cliente_whatsapp        text default null,
  p_descricao               text default null,
  p_observacao              text default null,
  p_tipo_entrega            public.delivery_type default 'retirada',
  p_endereco                text default null,
  p_taxa_entrega            numeric default 0,
  p_data_agendada           date default null,
  p_hora_agendada           time default null,
  p_data_prevista_pagamento date default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item     jsonb;
  v_subtotal numeric := 0;
  v_taxa     numeric := coalesce(p_taxa_entrega, 0);
  v_total    numeric;
  v_order    public.orders;
begin
  if not public.is_ativo() then
    raise exception 'Usuário inativo ou não autenticado.';
  end if;
  if coalesce(trim(p_cliente_nome), '') = '' then
    raise exception 'Informe o nome do cliente.';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_subtotal := v_subtotal + ((v_item->>'quantidade')::numeric * (v_item->>'preco_unitario')::numeric);
  end loop;

  v_total := coalesce(p_total, v_subtotal + v_taxa);

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0
     and coalesce(v_total, 0) = 0
     and coalesce(trim(p_descricao), '') = '' then
    raise exception 'Informe itens, um valor total ou uma descrição da encomenda.';
  end if;

  insert into public.orders (
    origem, cliente_nome, cliente_whatsapp, descricao, observacao,
    tipo_entrega, endereco, taxa_entrega, subtotal, total,
    data_agendada, hora_agendada, data_prevista_pagamento, funcionario_id
  ) values (
    'balcao', trim(p_cliente_nome), p_cliente_whatsapp, p_descricao, p_observacao,
    coalesce(p_tipo_entrega, 'retirada'), p_endereco, v_taxa, v_subtotal, v_total,
    p_data_agendada, p_hora_agendada, p_data_prevista_pagamento, auth.uid()
  ) returning * into v_order;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.order_items (order_id, product_id, product_nome, quantidade, preco_unitario, subtotal)
    values (
      v_order.id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_nome',
      (v_item->>'quantidade')::numeric,
      (v_item->>'preco_unitario')::numeric,
      (v_item->>'quantidade')::numeric * (v_item->>'preco_unitario')::numeric
    );
  end loop;

  return v_order;
end;
$$;

-- Atualiza dados de uma encomenda ainda PENDENTE.
create or replace function public.atualizar_encomenda(
  p_order_id                uuid,
  p_cliente_nome            text,
  p_total                   numeric,
  p_cliente_whatsapp        text default null,
  p_descricao               text default null,
  p_observacao              text default null,
  p_tipo_entrega            public.delivery_type default 'retirada',
  p_endereco                text default null,
  p_taxa_entrega            numeric default 0,
  p_data_agendada           date default null,
  p_hora_agendada           time default null,
  p_data_prevista_pagamento date default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not public.is_ativo() then
    raise exception 'Usuário inativo ou não autenticado.';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Encomenda não encontrada.';
  end if;
  if v_order.status <> 'pendente' then
    raise exception 'Só é possível editar encomendas pendentes.';
  end if;

  update public.orders set
    cliente_nome = trim(p_cliente_nome),
    cliente_whatsapp = p_cliente_whatsapp,
    descricao = p_descricao,
    observacao = p_observacao,
    tipo_entrega = coalesce(p_tipo_entrega, 'retirada'),
    endereco = p_endereco,
    taxa_entrega = coalesce(p_taxa_entrega, 0),
    total = coalesce(p_total, total),
    data_agendada = p_data_agendada,
    hora_agendada = p_hora_agendada,
    data_prevista_pagamento = p_data_prevista_pagamento
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

-- Muda o status. Transições válidas:
--   pendente -> entregue | pago | cancelado
--   entregue -> pago | cancelado | pendente (desfazer)
--   pago/cancelado -> (terminais)
create or replace function public.mudar_status_encomenda(
  p_order_id                uuid,
  p_status                  public.order_status,
  p_forma_pagamento         public.order_payment_method default null,
  p_data_prevista_pagamento date default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not public.is_ativo() then
    raise exception 'Usuário inativo ou não autenticado.';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Encomenda não encontrada.';
  end if;

  if v_order.status in ('pago', 'cancelado') then
    raise exception 'Encomenda % não pode mudar de status.', v_order.status;
  end if;

  if p_status = 'entregue' then
    update public.orders set
      status = 'entregue',
      data_entrega = coalesce(data_entrega, now()),
      data_prevista_pagamento = coalesce(p_data_prevista_pagamento, data_prevista_pagamento)
    where id = p_order_id returning * into v_order;

  elsif p_status = 'pago' then
    update public.orders set
      status = 'pago',
      data_pagamento = now(),
      forma_pagamento = p_forma_pagamento,
      data_entrega = coalesce(data_entrega, now())
    where id = p_order_id returning * into v_order;

  elsif p_status = 'cancelado' then
    update public.orders set status = 'cancelado' where id = p_order_id returning * into v_order;

  elsif p_status = 'pendente' then
    update public.orders set status = 'pendente', data_entrega = null where id = p_order_id returning * into v_order;

  else
    raise exception 'Status inválido.';
  end if;

  return v_order;
end;
$$;

-- ---------------- View: contas a receber ----------------
-- Encomendas entregues e ainda não pagas.
create view public.vw_contas_receber
with (security_invoker = true)
as
  select
    o.id,
    o.cliente_nome,
    o.total,
    o.data_entrega,
    o.data_prevista_pagamento,
    (o.data_prevista_pagamento is not null and o.data_prevista_pagamento < current_date) as vencido,
    case
      when o.data_prevista_pagamento is null then null
      else (o.data_prevista_pagamento - current_date)
    end as dias_para_vencer
  from public.orders o
  where o.status = 'entregue'
  order by o.data_prevista_pagamento nulls last, o.data_entrega;
