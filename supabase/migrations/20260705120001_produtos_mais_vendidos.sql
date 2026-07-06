-- =============================================================
-- "Mais vendidos" do PDV: campeões de venda GLOBAIS (de todos os operadores),
-- para atalho de 1 toque no balcão. SECURITY DEFINER porque a RLS de `sales`
-- restringe o funcionário às próprias vendas — aqui queremos o ranking da loja
-- inteira. Devolve só product_id + quantidade (nada sensível de faturamento).
-- =============================================================
create or replace function public.produtos_mais_vendidos(
  p_limite int default 8,
  p_dias int default 90
)
returns table (product_id uuid, quantidade numeric)
language sql security definer set search_path = public
as $$
  select si.product_id, sum(si.quantidade) as quantidade
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
   where s.status = 'concluida'
     and s.created_at >= now() - make_interval(days => greatest(p_dias, 1))
     and si.product_id is not null
   group by si.product_id
   order by sum(si.quantidade) desc
   limit greatest(p_limite, 1);
$$;

grant execute on function public.produtos_mais_vendidos(int, int) to authenticated;
