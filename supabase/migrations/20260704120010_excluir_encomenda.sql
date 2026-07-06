-- =============================================================
-- Excluir encomenda (para pedidos que não aconteceram / lançados por engano).
-- Só a administradora. Remove a encomenda e seus itens (cascade).
-- Diferente de "cancelar": não guarda registro — apaga de vez.
-- =============================================================

create or replace function public.excluir_encomenda(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas a administradora pode excluir encomendas.';
  end if;
  delete from public.orders where id = p_order_id;
end;
$$;
