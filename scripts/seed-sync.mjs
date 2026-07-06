#!/usr/bin/env node
// =============================================================================
// seed:sync — carrega o snapshot supabase/seeds/backfill.sql num banco de DESTINO
// (padrão: Supabase local), remapeando o token __ADMIN_ID__ para a dona (admin)
// do destino. Serve para: repovoar o local depois de um `db reset`, ou levar o
// histórico para a produção pela primeira vez.
//
// Uso:
//   npm run seed:sync                                  # carrega no local
//   DATABASE_URL="postgres://...prod..." npm run seed:sync   # carrega na produção
//   FORCE=1 npm run seed:sync                           # limpa e recarrega (destino já populado)
//
// Segurança: por padrão ABORTA se o destino já tem dados nessas tabelas (evita
// duplicar/misturar). Use FORCE=1 para LIMPAR as tabelas do backfill e recarregar.
// =============================================================================
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'

const TARGET =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const IN = 'supabase/seeds/backfill.sql'
const ADMIN_TOKEN = '__ADMIN_ID__'
const FORCE = process.env.FORCE === '1' || process.argv.includes('--force')
// Ordem inversa (filhos antes de pais) para o TRUNCATE respeitar as FKs.
const TABLES = ['order_items', 'orders', 'sale_items', 'sales', 'products', 'categories']

async function main() {
  let sql
  try {
    sql = readFileSync(IN, 'utf8')
  } catch {
    throw new Error(`Não achei ${IN}. Rode "npm run seed:dump" primeiro.`)
  }

  const client = new pg.Client({ connectionString: TARGET })
  await client.connect()
  console.log(`Destino: ${redact(TARGET)}`)

  const admin = await client.query("select id, nome from public.profiles where role = 'admin' order by created_at nulls first limit 1")
  if (!admin.rows[0]) {
    await client.end()
    throw new Error('O destino não tem usuário admin (dona). Rode a seed de produção antes.')
  }
  const targetAdminId = admin.rows[0].id
  console.log(`Dona no destino: ${admin.rows[0].nome} (${targetAdminId})`)

  // Checa se o destino já tem dados.
  const before = {}
  let populated = false
  for (const t of TABLES) {
    const r = await client.query(`select count(*)::int n from public.${t}`)
    before[t] = r.rows[0].n
    if (r.rows[0].n > 0) populated = true
  }

  if (populated && !FORCE) {
    await client.end()
    console.error('\n⚠ O destino já tem dados nessas tabelas:', JSON.stringify(before))
    console.error('  Para LIMPAR e recarregar, rode:  FORCE=1 npm run seed:sync')
    process.exit(1)
  }

  await client.end()

  // ATÔMICO: o TRUNCATE vai DENTRO do mesmo --single-transaction do load. Se o load
  // cair no meio (rede etc.), o truncate também é revertido — a produção NUNCA fica
  // vazia. (Antes o truncate rodava numa transação própria que commitava sozinha.)
  const truncatePrefix = FORCE && populated
    ? `truncate ${TABLES.map((t) => `public.${t}`).join(', ')} restart identity cascade;\n`
    : ''
  if (FORCE && populated) console.log('FORCE: vai limpar e recarregar numa transação só…', JSON.stringify(before))

  const substituted = truncatePrefix + sql.split(ADMIN_TOKEN).join(targetAdminId)
  const dir = mkdtempSync(join(tmpdir(), 'seedsync-'))
  const tmpFile = join(dir, 'backfill.sql')
  writeFileSync(tmpFile, substituted, 'utf8')

  console.log('Carregando…')
  execFileSync('psql', [TARGET, '--single-transaction', '--set', 'ON_ERROR_STOP=1', '-q', '-f', tmpFile], {
    stdio: ['ignore', 'inherit', 'inherit'],
    maxBuffer: 512 * 1024 * 1024,
  })

  // Confere as contagens finais.
  const after = new pg.Client({ connectionString: TARGET })
  await after.connect()
  const counts = {}
  for (const t of TABLES) counts[t] = (await after.query(`select count(*)::int n from public.${t}`)).rows[0].n
  await after.end()

  console.log('\n✓ Sync concluído. Linhas no destino:', JSON.stringify(counts))
}

function redact(url) {
  return url.replace(/:\/\/[^@]*@/, '://***@')
}

main().catch((e) => {
  console.error('Erro no seed:sync:', e.message)
  process.exit(1)
})
