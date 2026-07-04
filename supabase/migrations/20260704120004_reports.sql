-- =============================================================
-- Relatórios (views e funções de agregação)
-- =============================================================

-- Produtos abaixo do mínimo. security_invoker => respeita a RLS de products.
create view public.vw_estoque_baixo
with (security_invoker = true)
as
  select
    p.id,
    p.nome,
    p.unidade,
    p.estoque_atual,
    p.estoque_minimo,
    c.nome as categoria
  from public.products p
  left join public.categories c on c.id = p.categoria_id
  where p.ativo
    and p.controla_estoque
    and p.estoque_atual <= p.estoque_minimo
  order by (p.estoque_atual - p.estoque_minimo) asc, p.nome;

-- Resumo de vendas por forma de pagamento no período.
-- SECURITY INVOKER: admin vê tudo; funcionário vê só as próprias (via RLS).
create or replace function public.relatorio_vendas_resumo(
  p_inicio timestamptz,
  p_fim    timestamptz
)
returns table (
  forma_pagamento public.payment_method,
  qtd_vendas      bigint,
  total           numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select forma_pagamento, count(*)::bigint, coalesce(sum(total), 0)
  from public.sales
  where status = 'concluida'
    and created_at >= p_inicio
    and created_at < p_fim
  group by forma_pagamento
  order by forma_pagamento;
$$;

-- Produtos mais vendidos no período (RLS aplicada via join com sales).
create or replace function public.relatorio_produtos_vendidos(
  p_inicio timestamptz,
  p_fim    timestamptz,
  p_limite int default 20
)
returns table (
  product_id   uuid,
  product_nome text,
  quantidade   numeric,
  total        numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select si.product_id, si.product_nome,
         sum(si.quantidade) as quantidade,
         sum(si.subtotal)   as total
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.status = 'concluida'
    and s.created_at >= p_inicio
    and s.created_at < p_fim
  group by si.product_id, si.product_nome
  order by quantidade desc
  limit greatest(p_limite, 1);
$$;

-- Vendas por funcionário no período (somente admin).
create or replace function public.relatorio_por_funcionario(
  p_inicio timestamptz,
  p_fim    timestamptz
)
returns table (
  funcionario_id uuid,
  nome           text,
  qtd_vendas     bigint,
  total          numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas o administrador vê o relatório por funcionário.';
  end if;

  return query
    select pr.id, pr.nome, count(s.id)::bigint, coalesce(sum(s.total), 0)
    from public.profiles pr
    left join public.sales s
      on s.funcionario_id = pr.id
     and s.status = 'concluida'
     and s.created_at >= p_inicio
     and s.created_at < p_fim
    group by pr.id, pr.nome
    order by coalesce(sum(s.total), 0) desc;
end;
$$;
