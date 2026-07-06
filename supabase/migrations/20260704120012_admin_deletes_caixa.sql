-- =============================================================
-- 1) A administradora pode EXCLUIR dados errados (só ela). Os demais
--    continuam append-only. 2) caixa_resumo vira admin-only (balconista
--    não vê vendas/esperado). fechar_caixa calcula o esperado internamente.
-- =============================================================

-- ---------- Travas: permitir DELETE quando for admin ----------
create or replace function public.forbid_update_delete()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and public.is_admin() then
    return old;  -- administradora pode corrigir dados errados
  end if;
  raise exception 'Registros de % são imutáveis (append-only). Só a administradora pode excluir.', tg_table_name;
end;
$$;

create or replace function public.guard_sales_update()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if public.is_admin() then return old; end if;
    raise exception 'Vendas não podem ser apagadas. Use o cancelamento.';
  end if;

  if old.status = 'cancelada' then
    raise exception 'Venda já cancelada não pode ser alterada.';
  end if;

  if new.status = 'cancelada'
     and new.subtotal = old.subtotal and new.desconto = old.desconto
     and new.total = old.total and new.forma_pagamento = old.forma_pagamento
     and new.funcionario_id = old.funcionario_id
     and new.cash_session_id is not distinct from old.cash_session_id then
    return new;
  end if;

  raise exception 'Vendas são imutáveis; apenas o cancelamento é permitido.';
end;
$$;

create or replace function public.guard_cash_sessions()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if public.is_admin() then return old; end if;
    raise exception 'Sessões de caixa não podem ser apagadas.';
  end if;
  if old.status = 'fechado' then
    raise exception 'Caixa já fechado não pode ser alterado.';
  end if;
  return new;
end;
$$;

-- ---------- RPCs de exclusão (admin), corrigindo saldos ----------
create or replace function public.excluir_venda(p_sale_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Apenas a administradora pode excluir vendas.'; end if;

  -- devolve o estoque das vendas que controlam estoque (soma por produto).
  -- Vale tanto para vendas do PDV quanto de comandas: em ambos os casos a baixa
  -- foi de 1x a quantidade, então devolver por sale_items desfaz certinho.
  update public.products p
     set estoque_atual = p.estoque_atual + agg.qtd
    from (select product_id, sum(quantidade) as qtd
            from public.sale_items where sale_id = p_sale_id and product_id is not null
           group by product_id) agg
   where agg.product_id = p.id and p.controla_estoque;

  -- remove os movimentos de estoque: os da venda (PDV) E os das comandas que a
  -- geraram (a baixa da comanda usa referencia_id = comanda_id, não o sale_id).
  delete from public.stock_movements
   where referencia_id = p_sale_id
      or referencia_id in (select id from public.comandas where sale_id = p_sale_id);

  -- solta a FK comandas.sale_id apagando as comandas de origem (cascata em comanda_items)
  delete from public.comandas where sale_id = p_sale_id;

  delete from public.sales where id = p_sale_id;  -- cascata em sale_items
end;
$$;

create or replace function public.excluir_movimento_estoque(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_m public.stock_movements;
begin
  if not public.is_admin() then raise exception 'Apenas a administradora.'; end if;
  select * into v_m from public.stock_movements where id = p_id;
  if not found then raise exception 'Movimento não encontrado.'; end if;
  update public.products set estoque_atual = estoque_atual - v_m.quantidade
   where id = v_m.product_id and controla_estoque;
  delete from public.stock_movements where id = p_id;
end;
$$;

create or replace function public.excluir_movimento_caixa(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Apenas a administradora.'; end if;
  delete from public.cash_movements where id = p_id;
end;
$$;

-- ---------- caixa_resumo agora é ADMIN-ONLY ----------
create or replace function public.caixa_resumo(p_session_id uuid)
returns table (
  valor_abertura numeric, vendas_dinheiro numeric, vendas_outras numeric,
  suprimentos numeric, sangrias numeric, esperado_dinheiro numeric,
  informado numeric, diferenca numeric
)
language plpgsql security definer set search_path = public
as $$
declare v_session public.cash_sessions;
begin
  if not public.is_admin() then
    raise exception 'Apenas a administradora vê os valores do caixa.';
  end if;
  select * into v_session from public.cash_sessions where id = p_session_id;
  if not found then raise exception 'Sessão de caixa não encontrada.'; end if;

  valor_abertura := v_session.valor_abertura;
  vendas_dinheiro := coalesce((select sum(total) from public.sales
    where cash_session_id = p_session_id and status = 'concluida' and forma_pagamento = 'dinheiro'), 0);
  vendas_outras := coalesce((select sum(total) from public.sales
    where cash_session_id = p_session_id and status = 'concluida' and forma_pagamento <> 'dinheiro'), 0);
  suprimentos := coalesce((select sum(valor) from public.cash_movements
    where cash_session_id = p_session_id and tipo = 'suprimento'), 0);
  sangrias := coalesce((select sum(valor) from public.cash_movements
    where cash_session_id = p_session_id and tipo = 'sangria'), 0);
  esperado_dinheiro := valor_abertura + vendas_dinheiro + suprimentos - sangrias;
  informado := v_session.valor_fechamento_informado;
  diferenca := case when informado is null then null else informado - esperado_dinheiro end;
  return next;
end;
$$;

-- ---------- fechar_caixa calcula o esperado internamente (não depende de caixa_resumo) ----------
create or replace function public.fechar_caixa(
  p_valor_informado numeric,
  p_observacao      text default null
)
returns public.cash_sessions
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.cash_sessions;
  v_esperado numeric;
begin
  if not public.is_ativo() then raise exception 'Usuário inativo ou não autenticado.'; end if;

  select * into v_session from public.cash_sessions where status = 'aberto' limit 1;
  if not found then raise exception 'Nenhum caixa aberto para fechar.'; end if;

  v_esperado := v_session.valor_abertura
    + coalesce((select sum(total) from public.sales
        where cash_session_id = v_session.id and status = 'concluida' and forma_pagamento = 'dinheiro'), 0)
    + coalesce((select sum(valor) from public.cash_movements
        where cash_session_id = v_session.id and tipo = 'suprimento'), 0)
    - coalesce((select sum(valor) from public.cash_movements
        where cash_session_id = v_session.id and tipo = 'sangria'), 0);

  update public.cash_sessions
     set status = 'fechado', fechado_em = now(),
         valor_fechamento_informado = coalesce(p_valor_informado, 0),
         valor_fechamento_calculado = v_esperado,
         observacao = coalesce(p_observacao, observacao)
   where id = v_session.id
   returning * into v_session;

  return v_session;
end;
$$;
