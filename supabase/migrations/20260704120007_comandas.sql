-- =============================================================
-- Comandas / Mesas em aberto (pagam no final)
-- Nome livre (mesa ou cliente). O estoque BAIXA ao adicionar o item.
-- Ao fechar, vira uma venda no caixa aberto (sem baixar estoque de novo).
-- =============================================================

create type public.comanda_status as enum ('aberta', 'fechada', 'cancelada');

create table public.comandas (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  status          public.comanda_status not null default 'aberta',
  funcionario_id  uuid references public.profiles (id),
  cash_session_id uuid references public.cash_sessions (id),
  sale_id         uuid references public.sales (id),
  observacao      text,
  aberta_em       timestamptz not null default now(),
  fechada_em      timestamptz,
  created_at      timestamptz not null default now()
);
create index comandas_status_idx on public.comandas (status);

create table public.comanda_items (
  id             uuid primary key default gen_random_uuid(),
  comanda_id     uuid not null references public.comandas (id) on delete cascade,
  product_id     uuid references public.products (id),
  product_nome   text not null,
  quantidade     numeric(12,3) not null check (quantidade > 0),
  preco_unitario numeric(10,2) not null check (preco_unitario >= 0),
  custo_unitario numeric(10,2),
  subtotal       numeric(10,2) not null check (subtotal >= 0),
  usuario_id     uuid references public.profiles (id),
  created_at     timestamptz not null default now()
);
create index comanda_items_comanda_idx on public.comanda_items (comanda_id);

-- ---------------- RLS ----------------
alter table public.comandas enable row level security;
alter table public.comanda_items enable row level security;

create policy comandas_select on public.comandas
  for select using (public.is_ativo());

create policy comanda_items_select on public.comanda_items
  for select using (
    exists (select 1 from public.comandas c where c.id = comanda_id and public.is_ativo())
  );

-- ---------------- RPC ----------------
create or replace function public.abrir_comanda(p_nome text)
returns public.comandas
language plpgsql security definer set search_path = public
as $$
declare v_c public.comandas;
begin
  if not public.is_ativo() then raise exception 'Usuário inativo ou não autenticado.'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Dê um nome à comanda (mesa ou cliente).'; end if;
  insert into public.comandas (nome, funcionario_id) values (trim(p_nome), auth.uid()) returning * into v_c;
  return v_c;
end; $$;

create or replace function public.adicionar_item_comanda(
  p_comanda_id uuid,
  p_product_id uuid,
  p_quantidade numeric default 1
)
returns public.comanda_items
language plpgsql security definer set search_path = public
as $$
declare
  v_comanda public.comandas;
  v_prod    public.products;
  v_item    public.comanda_items;
begin
  if not public.is_ativo() then raise exception 'Usuário inativo ou não autenticado.'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade inválida.'; end if;

  select * into v_comanda from public.comandas where id = p_comanda_id for update;
  if not found then raise exception 'Comanda não encontrada.'; end if;
  if v_comanda.status <> 'aberta' then raise exception 'Comanda não está aberta.'; end if;

  select * into v_prod from public.products where id = p_product_id;
  if not found then raise exception 'Produto não encontrado.'; end if;
  if not v_prod.ativo then raise exception 'Produto "%" está inativo.', v_prod.nome; end if;

  insert into public.comanda_items (comanda_id, product_id, product_nome, quantidade, preco_unitario, custo_unitario, subtotal, usuario_id)
  values (p_comanda_id, v_prod.id, v_prod.nome, p_quantidade, v_prod.preco_venda, v_prod.custo, p_quantidade * v_prod.preco_venda, auth.uid())
  returning * into v_item;

  -- baixa estoque JÁ na adição (o salgado saiu da vitrine)
  if v_prod.controla_estoque then
    insert into public.stock_movements (product_id, tipo, quantidade, motivo, referencia_id, usuario_id)
    values (v_prod.id, 'venda', -1 * p_quantidade, 'Comanda: ' || v_comanda.nome, p_comanda_id, auth.uid());
  end if;

  return v_item;
end; $$;

create or replace function public.remover_item_comanda(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_item    public.comanda_items;
  v_comanda public.comandas;
begin
  if not public.is_ativo() then raise exception 'Usuário inativo ou não autenticado.'; end if;

  select * into v_item from public.comanda_items where id = p_item_id;
  if not found then raise exception 'Item não encontrado.'; end if;

  select * into v_comanda from public.comandas where id = v_item.comanda_id for update;
  if v_comanda.status <> 'aberta' then raise exception 'Comanda não está aberta.'; end if;

  -- estorna o estoque
  if v_item.product_id is not null
     and exists (select 1 from public.products where id = v_item.product_id and controla_estoque) then
    insert into public.stock_movements (product_id, tipo, quantidade, motivo, referencia_id, usuario_id)
    values (v_item.product_id, 'cancelamento', v_item.quantidade, 'Remoção de item da comanda', v_item.comanda_id, auth.uid());
  end if;

  delete from public.comanda_items where id = p_item_id;
end; $$;

-- Fecha a comanda: cria a venda no caixa aberto (NÃO baixa estoque de novo).
create or replace function public.fechar_comanda(
  p_comanda_id     uuid,
  p_forma_pagamento public.payment_method,
  p_desconto       numeric default 0,
  p_valor_recebido numeric default null
)
returns public.sales
language plpgsql security definer set search_path = public
as $$
declare
  v_comanda   public.comandas;
  v_session_id uuid;
  v_subtotal  numeric := 0;
  v_desconto  numeric := coalesce(p_desconto, 0);
  v_total     numeric;
  v_troco     numeric := null;
  v_sale      public.sales;
  v_item      public.comanda_items;
begin
  if not public.is_ativo() then raise exception 'Usuário inativo ou não autenticado.'; end if;

  select * into v_comanda from public.comandas where id = p_comanda_id for update;
  if not found then raise exception 'Comanda não encontrada.'; end if;
  if v_comanda.status <> 'aberta' then raise exception 'Comanda não está aberta.'; end if;

  select id into v_session_id from public.cash_sessions where status = 'aberto' limit 1;
  if v_session_id is null then raise exception 'Nenhum caixa aberto. Abra o caixa para receber.'; end if;

  select coalesce(sum(subtotal), 0) into v_subtotal from public.comanda_items where comanda_id = p_comanda_id;
  if v_subtotal <= 0 then raise exception 'A comanda está vazia.'; end if;
  if v_desconto < 0 then raise exception 'Desconto inválido.'; end if;
  if v_desconto > v_subtotal then raise exception 'Desconto maior que o total.'; end if;

  v_total := v_subtotal - v_desconto;
  if p_forma_pagamento = 'dinheiro' and p_valor_recebido is not null then
    if p_valor_recebido < v_total then raise exception 'Valor recebido menor que o total.'; end if;
    v_troco := p_valor_recebido - v_total;
  end if;

  insert into public.sales (
    cash_session_id, funcionario_id, cliente_nome,
    subtotal, desconto, total, forma_pagamento, valor_recebido, troco, status
  ) values (
    v_session_id, auth.uid(), v_comanda.nome,
    v_subtotal, v_desconto, v_total, p_forma_pagamento, p_valor_recebido, v_troco, 'concluida'
  ) returning * into v_sale;

  -- copia itens para a venda (SEM movimentar estoque de novo)
  for v_item in select * from public.comanda_items where comanda_id = p_comanda_id loop
    insert into public.sale_items (sale_id, product_id, product_nome, quantidade, preco_unitario, custo_unitario, subtotal)
    values (v_sale.id, v_item.product_id, v_item.product_nome, v_item.quantidade, v_item.preco_unitario, v_item.custo_unitario, v_item.subtotal);
  end loop;

  update public.comandas
     set status = 'fechada', fechada_em = now(), sale_id = v_sale.id, cash_session_id = v_session_id
   where id = p_comanda_id;

  return v_sale;
end; $$;

create or replace function public.cancelar_comanda(p_comanda_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_comanda public.comandas;
  v_item    public.comanda_items;
begin
  if not public.is_ativo() then raise exception 'Usuário inativo ou não autenticado.'; end if;

  select * into v_comanda from public.comandas where id = p_comanda_id for update;
  if not found then raise exception 'Comanda não encontrada.'; end if;
  if v_comanda.status <> 'aberta' then raise exception 'Comanda não está aberta.'; end if;

  for v_item in select * from public.comanda_items where comanda_id = p_comanda_id loop
    if v_item.product_id is not null
       and exists (select 1 from public.products where id = v_item.product_id and controla_estoque) then
      insert into public.stock_movements (product_id, tipo, quantidade, motivo, referencia_id, usuario_id)
      values (v_item.product_id, 'cancelamento', v_item.quantidade, 'Cancelamento da comanda', p_comanda_id, auth.uid());
    end if;
  end loop;

  update public.comandas set status = 'cancelada', fechada_em = now() where id = p_comanda_id;
end; $$;
