// ============================================================================
// Backfill: Firestore (export JSON) → Supabase (Postgres).
// Importa produtos/categorias, o histórico de VENDAS (orders fechadas) e as
// encomendas (commissions), preservando as datas originais. NÃO mexe no estoque
// nem no caixa atual (vendas antigas entram sem movimento de estoque e sem sessão).
//
// Uso:
//   DATABASE_URL="postgresql://postgres:SENHA@HOST:5432/postgres" node scripts/firebase-import.mjs
//   - Local:  DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//   - Produção: use a connection string do seu projeto Supabase (Project Settings → Database).
//   Rode UMA vez num banco limpo. Para forçar mesmo com vendas existentes: FORCE=1.
//   card → crédito por padrão; troque em PAY se preferir débito.
// ============================================================================
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('Defina DATABASE_URL (connection string do Postgres do Supabase).'); process.exit(1) }

const DIR = new URL('../firebase-export/', import.meta.url).pathname
const read = (f) => JSON.parse(readFileSync(`${DIR}${f}.json`, 'utf8'))
const tsISO = (t) => (t && t._seconds ? new Date(t._seconds * 1000).toISOString() : null)
const tsDate = (t) => (t && t._seconds ? new Date(t._seconds * 1000).toISOString().slice(0, 10) : null)

const PAY = { cash: 'dinheiro', pix: 'pix', card: 'credito' } // ajuste card→'debito' se quiser
const ENC_STATUS = { Pendente: 'pendente', Entregue: 'entregue', Pago: 'pago', Cancelado: 'cancelado' }

const client = new pg.Client({ connectionString: DATABASE_URL })

async function bulk(table, cols, rows, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk)
    const values = []
    const params = []
    slice.forEach((r, ri) => {
      values.push('(' + cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(',') + ')')
      cols.forEach((c) => params.push(r[c]))
    })
    await client.query(`insert into ${table} (${cols.join(',')}) values ${values.join(',')}`, params)
  }
}

await client.connect()
try {
  const jaTem = await client.query('select count(*)::int as n from public.sales')
  if (jaTem.rows[0].n > 0 && !process.env.FORCE) {
    throw new Error(`Já existem ${jaTem.rows[0].n} vendas no banco. Importe num banco limpo ou use FORCE=1.`)
  }

  const adminRes = await client.query("select id from public.profiles where role='admin' order by created_at limit 1")
  const adminId = adminRes.rows[0]?.id
  if (!adminId) throw new Error('Nenhum admin encontrado — rode as migrations antes.')

  await client.query('begin')

  // ---------- categorias (get-or-create por nome) ----------
  const products = read('products')
  const catNames = [...new Set(products.map((p) => (p.category || '').trim()).filter(Boolean))]
  const catMap = {}
  for (const [i, nome] of catNames.entries()) {
    const ex = await client.query('select id from public.categories where nome=$1', [nome])
    const id = ex.rows[0]?.id ?? randomUUID()
    if (!ex.rows[0]) await client.query('insert into public.categories (id,nome,ordem) values ($1,$2,$3)', [id, nome, i + 1])
    catMap[nome] = id
  }

  // ---------- produtos (map oldId → newId) ----------
  const prodMap = {}
  const prodRows = products.map((p) => {
    const id = randomUUID()
    prodMap[p.id] = id
    return {
      id, nome: p.name, categoria_id: catMap[(p.category || '').trim()] ?? null,
      preco_venda: Number(p.price) || 0, unidade: 'un',
      controla_estoque: false, estoque_atual: 0, estoque_minimo: 0, ativo: p.active !== false,
    }
  })
  await bulk('public.products',
    ['id', 'nome', 'categoria_id', 'preco_venda', 'unidade', 'controla_estoque', 'estoque_atual', 'estoque_minimo', 'ativo'],
    prodRows)

  // ---------- vendas + itens (orders fechadas com itens) ----------
  const orders = read('orders')
  const saleRows = []
  const itemRows = []
  let puladas = 0
  for (const o of orders) {
    if (o.status !== 'closed' || !Array.isArray(o.items) || o.items.length === 0) { puladas++; continue }
    const id = randomUUID()
    const total = Number(o.total) || 0
    saleRows.push({
      id, cash_session_id: null, funcionario_id: adminId, cliente_nome: null,
      subtotal: total, desconto: 0, total, forma_pagamento: PAY[o.paymentMethod] || 'dinheiro',
      valor_recebido: o.cashReceived ?? null, troco: o.change ?? null, status: 'concluida',
      created_at: tsISO(o.closedAt) || tsISO(o.createdAt) || new Date().toISOString(),
    })
    for (const it of o.items) {
      const q = Number(it.qty) || 0
      const pr = Number(it.price) || 0
      itemRows.push({
        sale_id: id, product_id: prodMap[it.productId] ?? null, product_nome: it.name || 'Item',
        quantidade: q, preco_unitario: pr, custo_unitario: null, subtotal: q * pr,
      })
    }
  }
  await bulk('public.sales',
    ['id', 'cash_session_id', 'funcionario_id', 'cliente_nome', 'subtotal', 'desconto', 'total', 'forma_pagamento', 'valor_recebido', 'troco', 'status', 'created_at'],
    saleRows)
  await bulk('public.sale_items',
    ['sale_id', 'product_id', 'product_nome', 'quantidade', 'preco_unitario', 'custo_unitario', 'subtotal'],
    itemRows)

  // ---------- encomendas (commissions → orders) ----------
  let encRows = []
  let encItemRows = []
  try {
    const commissions = read('commissions')
    for (const c of commissions) {
      const id = randomUUID()
      const sub = (c.items || []).reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.price) || 0), 0)
      encRows.push({
        id, origem: 'balcao', cliente_nome: c.customerName?.trim() || 'Cliente',
        cliente_whatsapp: c.customerPhone || null, tipo_entrega: 'retirada', taxa_entrega: 0,
        subtotal: sub, total: Number(c.total) || sub, status: ENC_STATUS[c.status] || 'pendente',
        data_agendada: tsDate(c.deliveryDate), funcionario_id: adminId,
        created_at: tsISO(c.createdAt) || new Date().toISOString(),
      })
      for (const it of c.items || []) {
        const q = Number(it.qty) || 0
        const pr = Number(it.price) || 0
        encItemRows.push({ order_id: id, product_id: prodMap[it.productId] ?? null, product_nome: it.name || 'Item', quantidade: q, preco_unitario: pr, subtotal: q * pr })
      }
    }
    if (encRows.length) await bulk('public.orders', ['id', 'origem', 'cliente_nome', 'cliente_whatsapp', 'tipo_entrega', 'taxa_entrega', 'subtotal', 'total', 'status', 'data_agendada', 'funcionario_id', 'created_at'], encRows)
    if (encItemRows.length) await bulk('public.order_items', ['order_id', 'product_id', 'product_nome', 'quantidade', 'preco_unitario', 'subtotal'], encItemRows)
  } catch (e) {
    console.warn('  (commissions ignoradas:', e.message, ')')
  }

  await client.query('commit')

  console.log('✓ Importação concluída:')
  console.log(`  categorias:  ${catNames.length}`)
  console.log(`  produtos:    ${prodRows.length}`)
  console.log(`  vendas:      ${saleRows.length} (itens: ${itemRows.length}) — puladas: ${puladas}`)
  console.log(`  encomendas:  ${encRows.length} (itens: ${encItemRows.length})`)
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('✗ Erro (nada foi gravado):', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
