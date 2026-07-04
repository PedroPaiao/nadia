-- =============================================================
-- Relatórios v2: lucro estimado, totais, série por dia.
-- Captura o CUSTO no momento da venda (snapshot) para o lucro histórico
-- não distorcer quando a dona reajustar o custo do produto.
-- =============================================================

alter table public.sale_items add column custo_unitario numeric(10,2);

-- Recria registrar_venda capturando o custo do produto na venda.
create or replace function public.registrar_venda(
  p_items          jsonb,
  p_forma_pagamento public.payment_method,
  p_desconto       numeric default 0,
  p_cliente_nome   text default null,
  p_valor_recebido numeric default null
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_session_id uuid;
  v_item       jsonb;
  v_pid        uuid;
  v_qtd        numeric;
  v_prod       public.products;
  v_subtotal   numeric := 0;
  v_desconto   numeric := coalesce(p_desconto, 0);
  v_total      numeric;
  v_troco      numeric := null;
  v_resolved   jsonb := '[]'::jsonb;
  v_sale       public.sales;
begin
  if not public.is_ativo() then
    raise exception 'Usuário inativo ou não autenticado.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A venda não tem itens.';
  end if;

  select id into v_session_id from public.cash_sessions where status = 'aberto' limit 1;
  if v_session_id is null then
    raise exception 'Nenhum caixa aberto. Abra o caixa antes de vender.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid;
    v_qtd := (v_item->>'quantidade')::numeric;
    if v_qtd is null or v_qtd <= 0 then
      raise exception 'Quantidade inválida em um dos itens.';
    end if;

    select * into v_prod from public.products where id = v_pid;
    if not found then
      raise exception 'Produto não encontrado.';
    end if;
    if not v_prod.ativo then
      raise exception 'Produto "%" está inativo.', v_prod.nome;
    end if;

    v_subtotal := v_subtotal + (v_qtd * v_prod.preco_venda);
    v_resolved := v_resolved || jsonb_build_object(
      'product_id', v_prod.id,
      'nome', v_prod.nome,
      'qtd', v_qtd,
      'preco', v_prod.preco_venda,
      'custo', v_prod.custo,
      'controla', v_prod.controla_estoque,
      'subtotal', v_qtd * v_prod.preco_venda
    );
  end loop;

  if v_desconto < 0 then
    raise exception 'Desconto inválido.';
  end if;
  if v_desconto > v_subtotal then
    raise exception 'Desconto maior que o total da venda.';
  end if;

  v_total := v_subtotal - v_desconto;

  if p_forma_pagamento = 'dinheiro' and p_valor_recebido is not null then
    if p_valor_recebido < v_total then
      raise exception 'Valor recebido menor que o total.';
    end if;
    v_troco := p_valor_recebido - v_total;
  end if;

  insert into public.sales (
    cash_session_id, funcionario_id, cliente_nome,
    subtotal, desconto, total, forma_pagamento, valor_recebido, troco, status
  ) values (
    v_session_id, v_uid, nullif(trim(coalesce(p_cliente_nome, '')), ''),
    v_subtotal, v_desconto, v_total, p_forma_pagamento, p_valor_recebido, v_troco, 'concluida'
  ) returning * into v_sale;

  for v_item in select * from jsonb_array_elements(v_resolved) loop
    insert into public.sale_items (sale_id, product_id, product_nome, quantidade, preco_unitario, custo_unitario, subtotal)
    values (
      v_sale.id,
      (v_item->>'product_id')::uuid,
      v_item->>'nome',
      (v_item->>'qtd')::numeric,
      (v_item->>'preco')::numeric,
      nullif(v_item->>'custo', '')::numeric,
      (v_item->>'subtotal')::numeric
    );

    if (v_item->>'controla')::boolean then
      insert into public.stock_movements (product_id, tipo, quantidade, motivo, referencia_id, usuario_id)
      values (
        (v_item->>'product_id')::uuid, 'venda', -1 * (v_item->>'qtd')::numeric, 'Venda', v_sale.id, v_uid
      );
    end if;
  end loop;

  return v_sale;
end;
$$;

-- Totais do período num único row (receita, descontos, custo, lucro, canceladas).
create or replace function public.relatorio_totais(
  p_inicio timestamptz,
  p_fim    timestamptz
)
returns table (
  receita          numeric,
  descontos        numeric,
  custo            numeric,
  lucro            numeric,
  qtd_vendas       bigint,
  ticket_medio     numeric,
  canceladas_qtd   bigint,
  canceladas_valor numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with v as (
    select * from public.sales
    where created_at >= p_inicio and created_at < p_fim
  ),
  concl as (select * from v where status = 'concluida'),
  custos as (
    select coalesce(sum(si.quantidade * coalesce(si.custo_unitario, 0)), 0) as custo
    from public.sale_items si
    join concl s on s.id = si.sale_id
  )
  select
    coalesce(sum(c.total), 0)                                   as receita,
    coalesce(sum(c.desconto), 0)                                as descontos,
    (select custo from custos)                                  as custo,
    coalesce(sum(c.total), 0) - (select custo from custos)      as lucro,
    count(c.id)::bigint                                         as qtd_vendas,
    case when count(c.id) > 0 then coalesce(sum(c.total),0) / count(c.id) else 0 end as ticket_medio,
    (select count(*) from v where status = 'cancelada')::bigint as canceladas_qtd,
    (select coalesce(sum(total),0) from v where status = 'cancelada') as canceladas_valor
  from concl c;
$$;

-- Série de vendas por dia (fuso America/Sao_Paulo).
create or replace function public.relatorio_vendas_por_dia(
  p_inicio timestamptz,
  p_fim    timestamptz
)
returns table (dia date, qtd_vendas bigint, total numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (created_at at time zone 'America/Sao_Paulo')::date as dia,
    count(*)::bigint,
    coalesce(sum(total), 0)
  from public.sales
  where status = 'concluida' and created_at >= p_inicio and created_at < p_fim
  group by 1
  order by 1;
$$;

-- Produtos mais vendidos agora com custo e lucro estimado.
drop function if exists public.relatorio_produtos_vendidos(timestamptz, timestamptz, int);
create or replace function public.relatorio_produtos_vendidos(
  p_inicio timestamptz,
  p_fim    timestamptz,
  p_limite int default 20
)
returns table (
  product_id   uuid,
  product_nome text,
  quantidade   numeric,
  total        numeric,
  custo        numeric,
  lucro        numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    si.product_id,
    si.product_nome,
    sum(si.quantidade)                                             as quantidade,
    sum(si.subtotal)                                              as total,
    sum(si.quantidade * coalesce(si.custo_unitario, 0))          as custo,
    sum(si.subtotal) - sum(si.quantidade * coalesce(si.custo_unitario, 0)) as lucro
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.status = 'concluida'
    and s.created_at >= p_inicio
    and s.created_at < p_fim
  group by si.product_id, si.product_nome
  order by quantidade desc
  limit greatest(p_limite, 1);
$$;
