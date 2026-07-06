import pg from 'pg'

// Conecta no Postgres do Supabase local (ou no DATABASE_URL passado no ambiente).
const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export const pool = new pg.Pool({ connectionString, max: 4, allowExitOnIdle: true })

const idCache = new Map<string, string>()

/** id do profile pelo login (ex.: 'admin', 'funcionario'). Cache por processo. */
export async function getUserId(usuario: string): Promise<string> {
  const cached = idCache.get(usuario)
  if (cached) return cached
  const r = await pool.query('select id from public.profiles where usuario = $1', [usuario])
  if (!r.rows[0]) throw new Error(`profile '${usuario}' não existe no banco de teste (rode a seed)`)
  idCache.set(usuario, r.rows[0].id as string)
  return r.rows[0].id as string
}

export interface Ctx {
  /** Executa SQL cru na transação do teste. */
  q: (text: string, params?: unknown[]) => Promise<pg.QueryResult>
  /** Primeira linha (ou undefined). */
  one: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T | undefined>
  /** Primeiro valor da primeira linha (útil para `... returning id` ou counts). */
  val: <T = unknown>(text: string, params?: unknown[]) => Promise<T>
  /** Passa a atuar como um usuário autenticado (RLS + auth.uid() = userId). */
  asUser: (userId: string) => Promise<void>
  /** Passa a atuar como visitante anônimo (role anon). */
  asAnon: () => Promise<void>
  /** Volta a atuar como superusuário (bypassa RLS) — para preparar dados de teste. */
  asSuperuser: () => Promise<void>
  /** id do profile pelo login. */
  userId: (usuario: string) => Promise<string>
  /** Chama uma RPC por nome com args nomeados: rpc('abrir_caixa', { p_valor_abertura: 150 }). */
  rpc: (name: string, args?: Record<string, unknown>) => Promise<pg.QueryResult>
  /** Espera que a query lance um erro cujo texto casa com `matcher`. */
  expectError: (run: () => Promise<unknown>, matcher: RegExp) => Promise<void>
}

/**
 * Roda `fn` dentro de uma transação SEMPRE revertida (rollback) — cada teste fica
 * isolado e não suja o banco. Impersona papéis exatamente como o PostgREST faz em
 * produção: `set local role` + `request.jwt.claims`. Assim os testes exercitam RLS,
 * `is_admin()`/`is_ativo()`, triggers append-only e as RPCs de verdade.
 */
export async function tx<T>(fn: (c: Ctx) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  await client.query('begin')

  async function setClaims(claims: Record<string, unknown>, role: string) {
    // Seta o claim como superusuário ANTES de trocar de papel (evita qualquer
    // questão de permissão), depois faz o downgrade para o papel do teste.
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
    await client.query(`set local role ${role}`)
  }

  const ctx: Ctx = {
    q: (text, params) => client.query(text, params as unknown[]),
    one: async (text, params) => (await client.query(text, params as unknown[])).rows[0],
    val: async (text, params) => {
      const r = await client.query(text, params as unknown[])
      const row = r.rows[0] ?? {}
      return Object.values(row)[0] as never
    },
    asUser: (userId) => setClaims({ sub: userId, role: 'authenticated' }, 'authenticated'),
    asAnon: () => setClaims({ role: 'anon' }, 'anon'),
    asSuperuser: async () => {
      await client.query('reset role')
    },
    userId: getUserId,
    rpc: (name, args = {}) => {
      const keys = Object.keys(args)
      const namedParams = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
      const values = keys.map((k) => args[k])
      return client.query(`select * from public.${name}(${namedParams})`, values)
    },
    expectError: async (run, matcher) => {
      let threw = false
      try {
        await run()
      } catch (e) {
        threw = true
        const msg = e instanceof Error ? e.message : String(e)
        if (!matcher.test(msg)) {
          throw new Error(`Erro veio, mas não casa com ${matcher}. Veio: "${msg}"`)
        }
      }
      if (!threw) throw new Error(`Esperava um erro casando ${matcher}, mas nada foi lançado.`)
    },
  }

  try {
    return await fn(ctx)
  } finally {
    await client.query('rollback').catch(() => {})
    client.release()
  }
}

/**
 * Cria um produto de teste (como superusuário, ignorando RLS) e devolve o id.
 * Use dentro de um `tx(...)`.
 */
export async function criarProduto(
  c: Ctx,
  over: Partial<{
    nome: string
    preco_venda: number
    custo: number
    unidade: string
    controla_estoque: boolean
    estoque_atual: number
    estoque_minimo: number
    ativo: boolean
  }> = {},
): Promise<string> {
  await c.asSuperuser()
  const p = {
    nome: 'Produto Teste ' + Math.round(Number(over.preco_venda ?? 0) * 1000 + (over.estoque_atual ?? 0)),
    preco_venda: 10,
    custo: 4,
    unidade: 'un',
    controla_estoque: true,
    estoque_atual: 100,
    estoque_minimo: 0,
    ativo: true,
    ...over,
  }
  return c.val(
    `insert into public.products (nome, preco_venda, custo, unidade, controla_estoque, estoque_atual, estoque_minimo, ativo)
     values ($1,$2,$3,$4::product_unit,$5,$6,$7,$8) returning id`,
    [p.nome, p.preco_venda, p.custo, p.unidade, p.controla_estoque, p.estoque_atual, p.estoque_minimo, p.ativo],
  )
}
