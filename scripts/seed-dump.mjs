#!/usr/bin/env node
// =============================================================================
// seed:dump — captura os dados HISTÓRICOS (o backfill do Firebase) do banco de
// ORIGEM num arquivo versionável: supabase/seeds/backfill.sql
//
// O que entra: categorias, produtos, vendas + itens e encomendas + itens.
// O que NÃO entra: usuários (profiles), caixa e movimentos — esses são de cada
// ambiente. O id da dona (admin) é substituído pelo token __ADMIN_ID__ para o
// seed:sync remapear para a dona do banco de DESTINO.
//
// Uso:
//   npm run seed:dump                # da origem padrão (Supabase local)
//   DATABASE_URL="postgres://..." npm run seed:dump   # de outra origem
// =============================================================================
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import pg from 'pg'

const SOURCE =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const OUT = 'supabase/seeds/backfill.sql'
const ADMIN_TOKEN = '__ADMIN_ID__'

// Ordem de dependência (pais antes de filhos) para o load respeitar as FKs.
const TABLES = ['categories', 'products', 'sales', 'sale_items', 'orders', 'order_items']

async function main() {
  const client = new pg.Client({ connectionString: SOURCE })
  await client.connect()

  const admin = await client.query("select id from public.profiles where role = 'admin' order by created_at nulls first limit 1")
  if (!admin.rows[0]) throw new Error('Nenhum usuário admin (dona) encontrado na origem.')
  const sourceAdminId = admin.rows[0].id

  // Coleta TODOS os operadores que aparecem em sales/orders (não só a dona): em
  // produção as vendas têm ids de balconistas também. Todos viram __ADMIN_ID__ e o
  // seed:sync remapeia para a dona do destino (dado histórico single-tenant).
  const funcRes = await client.query(
    `select distinct funcionario_id from (
       select funcionario_id from public.sales  where funcionario_id is not null
       union
       select funcionario_id from public.orders where funcionario_id is not null
     ) x`,
  )
  const funcIds = funcRes.rows.map((r) => r.funcionario_id)

  const counts = {}
  for (const t of TABLES) {
    const r = await client.query(`select count(*)::int n from public.${t}`)
    counts[t] = r.rows[0].n
  }
  await client.end()

  console.log(`Origem: ${redact(SOURCE)}`)
  console.log('Linhas:', JSON.stringify(counts))
  console.log(`admin (origem) = ${sourceAdminId} -> ${ADMIN_TOKEN}`)

  // pg_dump só dos dados, em formato COPY (blocos por tabela) — MUITO mais rápido
  // que INSERT por linha ao carregar pela rede (1 stream por tabela vs. 8k+ round-trips).
  // A tokenização por string ainda funciona: os uuids aparecem nas linhas do COPY.
  const args = [
    SOURCE,
    '--data-only',
    '--no-owner',
    '--no-privileges',
    '--no-comments',
    ...TABLES.flatMap((t) => ['--table', `public.${t}`]),
  ]
  let sql = execFileSync('pg_dump', args, { maxBuffer: 512 * 1024 * 1024 }).toString('utf8')

  // Remapeia TODO operador (dona + balconistas) para o token; o destino remapeia p/ a dona de lá.
  for (const id of new Set([sourceAdminId, ...funcIds])) sql = sql.split(id).join(ADMIN_TOKEN)

  // Portabilidade: remove SETs específicos de versões novas do pg_dump que
  // servidores mais antigos rejeitam (ex.: transaction_timeout do PG17+).
  sql = sql
    .split('\n')
    .filter((line) => !/^SET (transaction_timeout|idle_session_timeout)\b/.test(line))
    .join('\n')

  const header =
    `-- Seed do BACKFILL (dados históricos importados do Firebase).\n` +
    `-- Gerado por: npm run seed:dump — NÃO edite à mão.\n` +
    `-- Linhas: ${JSON.stringify(counts)}\n` +
    `-- Carregue com: npm run seed:sync  (remapeia ${ADMIN_TOKEN} para a dona do destino).\n\n`

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, header + sql, 'utf8')
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  console.log(`\n✓ Escrito ${OUT} (${total} linhas). Faça commit desse arquivo.`)
}

function redact(url) {
  return url.replace(/:\/\/[^@]*@/, '://***@')
}

main().catch((e) => {
  console.error('Erro no seed:dump:', e.message)
  process.exit(1)
})
