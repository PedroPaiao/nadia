-- =============================================================
-- Endurece mudar_status_encomenda: ao marcar uma encomenda como PAGO é
-- obrigatório informar a forma de pagamento (padrão de mercado: sempre se
-- registra COMO o dinheiro entrou). Antes, marcar 'pago' sem forma gravava
-- forma_pagamento = NULL silenciosamente — dado financeiro incompleto.
-- A UI já sempre envia a forma, então isso não quebra o fluxo atual.
-- =============================================================
create or replace function public.mudar_status_encomenda(
  p_order_id uuid,
  p_status public.order_status,
  p_forma_pagamento public.order_payment_method default null,
  p_data_prevista_pagamento date default null
)
returns public.orders
language plpgsql security definer set search_path = public
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
    if p_forma_pagamento is null then
      raise exception 'Informe a forma de pagamento ao marcar a encomenda como paga.';
    end if;
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
