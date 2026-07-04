# Salgaderia — PDV, Caixa e Estoque

Sistema de ponto de venda para a salgaderia: vendas no balcão, gestão de caixa
(abertura, sangria/suprimento, fechamento com conferência), controle de estoque,
funcionários e relatórios — incluindo **auditoria de caixa** para a dona conferir
depois. Feito para uso interno (uma empresa), simples de operar no balcão.

- **Frontend:** React + Vite + TypeScript + Tailwind
- **Backend:** Supabase (Postgres + Auth + RLS) — local via Docker no desenvolvimento
- **Login:** por **usuário + senha** (sem e-mail). A dona cria os usuários pelo painel.

> Fase 1 (este repositório): sistema interno completo.
> Fase 2 (planejada): loja online de encomendas (cliente pede sozinho: retirada/entrega,
> pagamento na retirada, identificação por nome + WhatsApp).

---

## Pré-requisitos

- **Node.js 20+**
- **Docker Desktop** (para rodar o Supabase local)

## Rodando localmente

```bash
# 1. Instalar dependências
npm install

# 2. Subir o Supabase local (Postgres + Auth). A 1ª vez baixa as imagens Docker.
npm run db:start

# 3. Criar o schema + dados de exemplo (migrations + seed)
npm run db:reset

# 4. Copiar as variáveis de ambiente (valores padrão do Supabase local)
cp .env.example .env.local
#   Se precisar, confira a URL/chave com:  npm run db:status

# 5. Rodar o app
npm run dev        # abre em http://localhost:5173
```

### Usuários de teste (criados pelo seed)

| Usuário | Senha        | Papel          |
|---------|--------------|----------------|
| `admin` | `Secret123!` | Dona (admin)   |
| `maria` | `123456`     | Funcionária    |
| `joao`  | `123456`     | Funcionário    |

> Convenção: **funcionários usam a senha rápida `123456`** (para a troca rápida de
> operador no balcão) e a **dona usa uma senha forte**. Troque as senhas em produção.

### Troca rápida de operador
No topo há o botão de **trocar operador**: com a senha rápida `123456` você entra como
qualquer funcionário (as vendas passam a contar para ele); para voltar à conta da **dona**
é preciso a senha forte dela.

## Scripts

| Comando            | O que faz                                        |
|--------------------|--------------------------------------------------|
| `npm run dev`      | Sobe o frontend (Vite) em modo desenvolvimento    |
| `npm run build`    | Type-check + build de produção (pasta `dist/`)    |
| `npm run lint`     | Só o type-check (`tsc --noEmit`)                  |
| `npm run db:start` | Sobe o Supabase local                            |
| `npm run db:stop`  | Para o Supabase local                            |
| `npm run db:reset` | Recria o banco: migrations + seed                |
| `npm run db:status`| Mostra URLs e chaves do Supabase local           |

## Fluxo de uso

1. **Produtos** (admin): cadastre categorias e produtos com preço e estoque.
2. **Funcionários** (admin): crie os logins da equipe.
3. **Caixa**: abra o caixa informando o fundo de troco.
4. **PDV**: monte a venda, escolha a forma de pagamento e finalize (baixa o estoque).
5. **Caixa**: registre sangrias/suprimentos e feche o caixa conferindo o dinheiro.
6. **Relatórios** (admin): vendas do dia, por funcionário, mais vendidos e a
   **auditoria de caixa** (histórico imutável de aberturas/fechamentos).

## Deploy (grátis)

**Banco — Supabase Cloud (free tier):**
1. Crie um projeto em [supabase.com](https://supabase.com).
2. Faça login e link do projeto:
   ```bash
   npx supabase login
   npx supabase link --project-ref SEU_PROJECT_REF
   npx supabase db push        # aplica as migrations no projeto da nuvem
   ```
3. Rode o conteúdo de **`supabase/seed-producao.sql`** uma vez no SQL Editor: ele cria
   **apenas a conta da dona** (`admin` / `Secret123!`), sem dados de exemplo. Depois entre,
   troque a senha e cadastre produtos e funcionários pelo painel.
4. Pegue **Project URL** e **anon key** em *Project Settings → API*.

**Frontend — Vercel (ou Netlify/Cloudflare Pages):**
1. Suba este repositório no GitHub e importe na Vercel.
2. Configure as variáveis de ambiente:
   - `VITE_SUPABASE_URL` = Project URL do Supabase
   - `VITE_SUPABASE_ANON_KEY` = anon key do Supabase
3. Build command: `npm run build` — Output: `dist`.

## Segurança e integridade

- **RLS** (Row Level Security) ligada em todas as tabelas: cada funcionário só vê o
  que deve; relatórios gerenciais e criação de usuários são exclusivos do admin.
- Vendas, itens, movimentos de estoque e de caixa são **append-only** (imutáveis):
  não podem ser editados nem apagados — só estornados por novos lançamentos. Isso
  garante uma trilha de auditoria confiável.
- Preços das vendas são sempre recalculados no servidor (nunca confiam no cliente).

## Estrutura

```
supabase/
  migrations/        schema, triggers, RLS e funções (RPC)
  seed.sql           usuários e produtos de exemplo
  seed-producao.sql  cria só a conta da dona (para produção)
src/
  auth/              login, contexto de autenticação, guardas, troca de operador
  components/        UI base, layout, toasts, combobox, date/time picker, pagamento
  features/
    pdv/             tela de venda (checkout com valor rápido)
    comandas/        mesas/comandas em aberto (pagam no final)
    encomendas/      pedidos agendados + contas a receber
    caixa/           abertura/fechamento, sangria/suprimento
    estoque/         dashboard, movimentações e alerta de mínimo
    produtos/        produtos e categorias
    funcionarios/    gestão de usuários (admin)
    relatorios/      vendas, lucro, auditoria de caixa
  lib/               cliente Supabase, utilidades
  types/             tipos do banco
```
