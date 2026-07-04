-- =============================================================
-- Funções RPC (regras de negócio) — transacionais.
-- =============================================================

-- ---------- Criação de usuários ----------
-- Interna: cria o usuário em auth.users + auth.identities + profiles.
-- Executável só pelo dono (postgres) e pelas funções que a chamam — nunca direto pelo cliente.
create or replace function public.criar_usuario_interno(
  p_usuario text,
  p_senha   text,
  p_nome    text,
  p_role    public.user_role
)
returns public.profiles
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email   text;
  v_usuario text := lower(trim(p_usuario));
  v_uid     uuid := gen_random_uuid();
  v_profile public.profiles;
begin
  if v_usuario is null or v_usuario = '' then
    raise exception 'Informe um nome de usuário.';
  end if;
  if length(coalesce(p_senha, '')) < 4 then
    raise exception 'A senha deve ter ao menos 4 caracteres.';
  end if;

  v_email := v_usuario || '@salgaderia.local';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_senha, extensions.gen_salt('bf')),
    now(), now(), now(),
    '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('nome', p_nome)
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid::text, v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  insert into public.profiles (id, nome, usuario, role, ativo)
  values (v_uid, p_nome, v_usuario, p_role, true)
  returning * into v_profile;

  return v_profile;
exception
  when unique_violation then
    raise exception 'Já existe um usuário com esse login (%).', v_usuario;
end;
$$;
revoke all on function public.criar_usuario_interno(text, text, text, public.user_role) from public, anon, authenticated;

-- Pública para o admin: cria funcionário/admin pelo painel.
create or replace function public.admin_criar_usuario(
  p_usuario text,
  p_senha   text,
  p_nome    text,
  p_role    public.user_role default 'funcionario'
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas o administrador pode criar usuários.';
  end if;
  return public.criar_usuario_interno(p_usuario, p_senha, p_nome, p_role);
end;
$$;

-- Admin redefine a senha de um usuário.
create or replace function public.admin_resetar_senha(
  p_user_id uuid,
  p_senha   text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas o administrador pode redefinir senhas.';
  end if;
  if length(coalesce(p_senha, '')) < 4 then
    raise exception 'A senha deve ter ao menos 4 caracteres.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
end;
$$;

-- ---------- Estoque ----------
-- Registra entrada ou ajuste manual. p_quantidade com sinal (positivo entra, negativo sai).
create or replace function public.registrar_movimento_estoque(
  p_product_id uuid,
  p_tipo       public.movement_type,
  p_quantidade numeric,
  p_motivo     text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mov public.stock_movements;
begin
  if not public.is_ativo() then
    raise exception 'Usuário inativo ou não autenticado.';
  end if;
  if p_tipo not in ('entrada', 'ajuste', 'saida') then
    raise exception 'Tipo de movimento inválido para lançamento manual.';
  end if;
  if p_quantidade = 0 then
    raise exception 'Quantidade não pode ser zero.';
  end if;

  insert into public.stock_movements (product_id, tipo, quantidade, motivo, usuario_id)
  values (p_product_id, p_tipo, p_quantidade, p_motivo, auth.uid())
  returning * into v_mov;

  return v_mov;
end;
$$;

-- ---------- Caixa ----------
create or replace function public.abrir_caixa(
  p_valor_abertura numeric default 0,
  p_observacao     text default null
)
returns public.cash_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.cash_sessions;
begin
  if not public.is_ativo() then
    raise exception 'Usuário inativo ou não autenticado.';
  end if;
  if exists (select 1 from public.cash_sessions where status = 'aberto') then
    raise exception 'Já existe um caixa aberto. Feche-o antes de abrir outro.';
  end if;

  insert into public.cash_sessions (funcionario_id, valor_abertura, observacao)
  values (auth.uid(), coalesce(p_valor_abertura, 0), p_observacao)
  returning * into v_session;

  return v_session;
end;
$$;

create or replace function public.registrar_movimento_caixa(
  p_tipo   public.cash_movement_type,
  p_valor  numeric,
  p_motivo text default null
)
returns public.cash_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_mov public.cash_movements;
begin
  if not public.is_ativo() then
    raise exception 'Usuário inativo ou não autenticado.';
  end if;
  if coalesce(p_valor, 0) <= 0 then
    raise exception 'Informe um valor maior que zero.';
  end if;

  select id into v_session_id from public.cash_sessions where status = 'aberto' limit 1;
  if v_session_id is null then
    raise exception 'Nenhum caixa aberto.';
  end if;

  insert into public.cash_movements (cash_session_id, tipo, valor, motivo, usuario_id)
  values (v_session_id, p_tipo, p_valor, p_motivo, auth.uid())
  returning * into v_mov;

  return v_mov;
end;
$$;

-- Resumo financeiro de uma sessão (usado no fechamento e na auditoria).
create or replace function public.caixa_resumo(p_session_id uuid)
returns table (
  valor_abertura    numeric,
  vendas_dinheiro   numeric,
  vendas_outras     numeric,
  suprimentos       numeric,
  sangrias          numeric,
  esperado_dinheiro numeric,
  informado         numeric,
  diferenca         numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.cash_sessions;
begin
  select * into v_session from public.cash_sessions where id = p_session_id;
  if not found then
    raise exception 'Sessão de caixa não encontrada.';
  end if;
  if not (public.is_admin() or v_session.funcionario_id = auth.uid()) then
    raise exception 'Sem permissão para ver este caixa.';
  end if;

  valor_abertura := v_session.valor_abertura;
  vendas_dinheiro := coalesce((
    select sum(total) from public.sales
    where cash_session_id = p_session_id and status = 'concluida' and forma_pagamento = 'dinheiro'
  ), 0);
  vendas_outras := coalesce((
    select sum(total) from public.sales
    where cash_session_id = p_session_id and status = 'concluida' and forma_pagamento <> 'dinheiro'
  ), 0);
  suprimentos := coalesce((
    select sum(valor) from public.cash_movements
    where cash_session_id = p_session_id and tipo = 'suprimento'
  ), 0);
  sangrias := coalesce((
    select sum(valor) from public.cash_movements
    where cash_session_id = p_session_id and tipo = 'sangria'
  ), 0);
  esperado_dinheiro := valor_abertura + vendas_dinheiro + suprimentos - sangrias;
  informado := v_session.valor_fechamento_informado;
  diferenca := case when informado is null then null else informado - esperado_dinheiro end;

  return next;
end;
$$;

create or replace function public.fechar_caixa(
  p_valor_informado numeric,
  p_observacao      text default null
)
returns public.cash_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.cash_sessions;
  v_esperado numeric;
begin
  if not public.is_ativo() then
    raise exception 'Usuário inativo ou não autenticado.';
  end if;

  select * into v_session from public.cash_sessions where status = 'aberto' limit 1;
  if not found then
    raise exception 'Nenhum caixa aberto para fechar.';
  end if;

  select esperado_dinheiro into v_esperado from public.caixa_resumo(v_session.id);

  update public.cash_sessions
     set status = 'fechado',
         fechado_em = now(),
         valor_fechamento_informado = coalesce(p_valor_informado, 0),
         valor_fechamento_calculado = v_esperado,
         observacao = coalesce(p_observacao, observacao)
   where id = v_session.id
   returning * into v_session;

  return v_session;
end;
$$;

-- ---------- Vendas ----------
-- p_items: jsonb array [{ "product_id": "...", "quantidade": 2 }, ...]
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

  -- 1) validar itens e calcular subtotal (preço vem do servidor, não do cliente)
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

  -- 2) criar a venda
  insert into public.sales (
    cash_session_id, funcionario_id, cliente_nome,
    subtotal, desconto, total, forma_pagamento, valor_recebido, troco, status
  ) values (
    v_session_id, v_uid, nullif(trim(coalesce(p_cliente_nome, '')), ''),
    v_subtotal, v_desconto, v_total, p_forma_pagamento, p_valor_recebido, v_troco, 'concluida'
  ) returning * into v_sale;

  -- 3) itens + baixa de estoque
  for v_item in select * from jsonb_array_elements(v_resolved) loop
    insert into public.sale_items (sale_id, product_id, product_nome, quantidade, preco_unitario, subtotal)
    values (
      v_sale.id,
      (v_item->>'product_id')::uuid,
      v_item->>'nome',
      (v_item->>'qtd')::numeric,
      (v_item->>'preco')::numeric,
      (v_item->>'subtotal')::numeric
    );

    if (v_item->>'controla')::boolean then
      insert into public.stock_movements (product_id, tipo, quantidade, motivo, referencia_id, usuario_id)
      values (
        (v_item->>'product_id')::uuid,
        'venda',
        -1 * (v_item->>'qtd')::numeric,
        'Venda',
        v_sale.id,
        v_uid
      );
    end if;
  end loop;

  return v_sale;
end;
$$;

-- Cancela uma venda concluída, estorna o estoque e marca como cancelada.
create or replace function public.cancelar_venda(
  p_sale_id uuid,
  p_motivo  text default null
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales;
  v_item public.sale_items;
begin
  if not public.is_ativo() then
    raise exception 'Usuário inativo ou não autenticado.';
  end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    raise exception 'Venda não encontrada.';
  end if;
  if not (public.is_admin() or v_sale.funcionario_id = auth.uid()) then
    raise exception 'Sem permissão para cancelar esta venda.';
  end if;
  if v_sale.status = 'cancelada' then
    raise exception 'Venda já cancelada.';
  end if;

  -- estorna estoque dos itens que controlam estoque
  for v_item in select * from public.sale_items where sale_id = p_sale_id loop
    if v_item.product_id is not null
       and exists (select 1 from public.products where id = v_item.product_id and controla_estoque) then
      insert into public.stock_movements (product_id, tipo, quantidade, motivo, referencia_id, usuario_id)
      values (v_item.product_id, 'cancelamento', v_item.quantidade,
              coalesce('Cancelamento: ' || p_motivo, 'Cancelamento de venda'),
              p_sale_id, auth.uid());
    end if;
  end loop;

  update public.sales set status = 'cancelada' where id = p_sale_id returning * into v_sale;
  return v_sale;
end;
$$;
