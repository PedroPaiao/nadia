-- =============================================================
-- Dados iniciais (rodados no `supabase db reset`)
-- Usuários de teste:
--   admin / Secret123!   (dona / administradora — senha forte)
--   maria / 123456       (funcionária — senha rápida de balcão)
-- Convenção: funcionários usam a senha rápida 123456 (troca rápida no balcão);
-- a conta da dona usa uma senha forte.
-- =============================================================

select public.criar_usuario_interno('admin', 'Secret123!', 'Administradora', 'admin');
select public.criar_usuario_interno('maria', '123456', 'Maria (Balcão)', 'funcionario');
select public.criar_usuario_interno('joao', '123456', 'João (Balcão)', 'funcionario');

insert into public.categories (nome, ordem) values
  ('Salgados Fritos', 1),
  ('Salgados Assados', 2),
  ('Doces', 3),
  ('Bebidas', 4);

insert into public.products
  (nome, categoria_id, preco_venda, custo, unidade, controla_estoque, estoque_atual, estoque_minimo)
select p.nome, c.id, p.preco, p.custo, p.unidade::public.product_unit, p.controla, p.estoque, p.minimo
from (values
  ('Coxinha de Frango',        'Salgados Fritos',  7.00, 3.00, 'un',    true,  80,  20),
  ('Kibe',                     'Salgados Fritos',  7.00, 3.00, 'un',    true,  60,  20),
  ('Bolinha de Queijo',        'Salgados Fritos',  6.50, 2.50, 'un',    true,  50,  20),
  ('Risoles de Carne',         'Salgados Fritos',  7.00, 3.00, 'un',    true,  40,  15),
  ('Empada de Frango',         'Salgados Assados', 8.00, 3.50, 'un',    true,  30,  10),
  ('Esfiha de Carne',          'Salgados Assados', 6.00, 2.50, 'un',    true,  35,  10),
  ('Pão de Queijo',            'Salgados Assados', 4.00, 1.50, 'un',    true,  45,  15),
  ('Salgados Sortidos',        'Salgados Fritos', 60.00,28.00, 'cento', true,  10,   3),
  ('Brigadeiro',              'Doces',            3.50, 1.20, 'un',    true,  40,  10),
  ('Beijinho',                'Doces',            3.50, 1.20, 'un',    true,  30,  10),
  ('Refrigerante Lata',        'Bebidas',          6.00, 3.00, 'un',    true,  48,  12),
  ('Água Mineral 500ml',       'Bebidas',          4.00, 1.50, 'un',    true,  36,  12),
  ('Suco Natural 300ml',       'Bebidas',          8.00, 3.50, 'un',    false,  0,   0)
) as p(nome, categoria, preco, custo, unidade, controla, estoque, minimo)
join public.categories c on c.nome = p.categoria;

-- ---------- Encomendas de exemplo ----------
insert into public.orders
  (cliente_nome, descricao, tipo_entrega, subtotal, total, status,
   data_agendada, data_entrega, data_prevista_pagamento, funcionario_id, observacao)
values
  -- Licitação entregue, aguardando pagamento (a vencer)
  ('Prefeitura Municipal - Licitação 12/2026', '2.000 salgados sortidos para evento',
   'entrega', 0, 1200.00, 'entregue',
   date '2026-07-01', timestamp '2026-07-01 10:00', date '2026-07-21',
   (select id from public.profiles where usuario = 'admin'),
   'Pagamento por empenho, 20 dias após a entrega.'),
  -- Licitação entregue, pagamento VENCIDO
  ('Escola Estadual Central - Licitação 08/2026', '1.500 coxinhas e 500 doces',
   'entrega', 0, 890.00, 'entregue',
   date '2026-06-10', timestamp '2026-06-10 09:00', date '2026-06-30',
   (select id from public.profiles where usuario = 'admin'),
   'Aguardando repasse.'),
  -- Encomenda pendente (festa), agendada
  ('Dona Cleuza (aniversário)', '100 coxinhas + 100 quibes para festa',
   'retirada', 0, 140.00, 'pendente',
   date '2026-07-10', null, null,
   (select id from public.profiles where usuario = 'maria'), null),
  -- Encomenda já paga (histórico)
  ('Buffet Estrela', 'Salgados para casamento',
   'entrega', 0, 650.00, 'pago',
   date '2026-06-20', timestamp '2026-06-20 08:00', date '2026-06-20',
   (select id from public.profiles where usuario = 'admin'), null);

update public.orders set data_pagamento = timestamp '2026-06-25 14:00', forma_pagamento = 'transferencia'
where cliente_nome = 'Buffet Estrela';
