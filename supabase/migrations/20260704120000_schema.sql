-- =============================================================
-- Salgaderia PDV — Schema base (Fase 1)
-- Tabelas de cadastro, estoque, caixa e vendas.
-- =============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tipos (enums) ----------
create type public.user_role          as enum ('admin', 'funcionario');
create type public.product_unit       as enum ('un', 'cento', 'kg');
create type public.movement_type      as enum ('entrada', 'saida', 'ajuste', 'venda', 'cancelamento');
create type public.cash_status        as enum ('aberto', 'fechado');
create type public.cash_movement_type as enum ('sangria', 'suprimento');
create type public.payment_method     as enum ('dinheiro', 'pix', 'debito', 'credito');
create type public.sale_status        as enum ('concluida', 'cancelada');

-- ---------- profiles (espelha auth.users) ----------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nome        text not null,
  usuario     text not null unique,
  role        public.user_role not null default 'funcionario',
  ativo       boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table public.profiles is 'Dados do funcionário. usuario = login (sem e-mail).';

-- ---------- categorias ----------
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  ordem      int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- produtos ----------
create table public.products (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  categoria_id      uuid references public.categories (id) on delete set null,
  preco_venda       numeric(10,2) not null default 0 check (preco_venda >= 0),
  custo             numeric(10,2) check (custo >= 0),
  unidade           public.product_unit not null default 'un',
  controla_estoque  boolean not null default true,
  estoque_atual     numeric(12,3) not null default 0,
  estoque_minimo    numeric(12,3) not null default 0 check (estoque_minimo >= 0),
  ativo             boolean not null default true,
  imagem_url        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index products_categoria_idx on public.products (categoria_id);
create index products_ativo_idx on public.products (ativo);

-- ---------- movimentações de estoque (trilha de auditoria) ----------
-- quantidade = variação COM sinal aplicada ao estoque:
--   entrada/cancelamento => positivo ; saida/venda => negativo ; ajuste => qualquer sinal.
create table public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id),
  tipo          public.movement_type not null,
  quantidade    numeric(12,3) not null,
  estoque_apos  numeric(12,3),
  motivo        text,
  referencia_id uuid,
  usuario_id    uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);

-- ---------- sessões de caixa ----------
create table public.cash_sessions (
  id                          uuid primary key default gen_random_uuid(),
  funcionario_id              uuid not null references public.profiles (id),
  valor_abertura              numeric(10,2) not null default 0 check (valor_abertura >= 0),
  valor_fechamento_informado  numeric(10,2),
  valor_fechamento_calculado  numeric(10,2),
  aberto_em                   timestamptz not null default now(),
  fechado_em                  timestamptz,
  status                      public.cash_status not null default 'aberto',
  observacao                  text
);
-- Garante no máximo UM caixa aberto por vez (single-tenant, um balcão).
create unique index cash_sessions_um_aberto_idx
  on public.cash_sessions ((status))
  where status = 'aberto';

-- ---------- movimentos de caixa (sangria / suprimento) ----------
create table public.cash_movements (
  id              uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions (id),
  tipo            public.cash_movement_type not null,
  valor           numeric(10,2) not null check (valor > 0),
  motivo          text,
  usuario_id      uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index cash_movements_session_idx on public.cash_movements (cash_session_id);

-- ---------- vendas ----------
create table public.sales (
  id              uuid primary key default gen_random_uuid(),
  cash_session_id uuid references public.cash_sessions (id),
  funcionario_id  uuid not null references public.profiles (id),
  cliente_nome    text,
  subtotal        numeric(10,2) not null check (subtotal >= 0),
  desconto        numeric(10,2) not null default 0 check (desconto >= 0),
  total           numeric(10,2) not null check (total >= 0),
  forma_pagamento public.payment_method not null,
  valor_recebido  numeric(10,2),
  troco           numeric(10,2),
  status          public.sale_status not null default 'concluida',
  created_at      timestamptz not null default now()
);
create index sales_created_idx on public.sales (created_at desc);
create index sales_funcionario_idx on public.sales (funcionario_id);
create index sales_session_idx on public.sales (cash_session_id);

-- ---------- itens da venda (snapshot de nome e preço) ----------
create table public.sale_items (
  id             uuid primary key default gen_random_uuid(),
  sale_id        uuid not null references public.sales (id) on delete cascade,
  product_id     uuid references public.products (id),
  product_nome   text not null,
  quantidade     numeric(12,3) not null check (quantidade > 0),
  preco_unitario numeric(10,2) not null check (preco_unitario >= 0),
  subtotal       numeric(10,2) not null check (subtotal >= 0)
);
create index sale_items_sale_idx on public.sale_items (sale_id);
