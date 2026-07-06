import { describe, it, expect } from 'vitest'
import { tx, criarProduto } from '../helpers/db'
import type { Ctx } from '../helpers/db'

// Regras de EXCLUSÃO (deletes) + RLS/triggers append-only.
// Só a administradora (dona = usuário 'admin') pode excluir vendas, movimentos de
// estoque e movimentos de caixa. Funcionários (funcionario) são barrados.
// Tabelas sale_items / stock_movements / cash_movements são append-only: DELETE direto
// é proibido para funcionário; a administradora pode (o trigger retorna old).
// Cada teste roda numa transação revertida no fim — nada é gravado de verdade.

// Um erro levantado dentro de uma RPC aborta a transação inteira: qualquer query
// seguinte falha com "current transaction is aborted". Como queremos ASSERTAR o
// estado DEPOIS do erro (invariante de segurança: nada foi mutado antes de barrar),
// cercamos a chamada num SAVEPOINT e voltamos a ele. Assim o erro é verificado e a
// transação segue utilizável para os SELECTs de invariante.
async function esperaErroPreservandoTx(
  c: Ctx,
  run: () => Promise<unknown>,
  matcher: RegExp,
): Promise<void> {
  await c.q('savepoint antes_do_erro')
  try {
    await c.expectError(run, matcher)
  } finally {
    // Rola de volta ao ponto salvo em AMBOS os casos: se o erro veio, limpa o estado
    // abortado; se não veio (bug!), expectError já lançou e o finally só reabilita a tx.
    await c.q('rollback to savepoint antes_do_erro')
  }
}

describe('excluir_venda', () => {
  it('SÓ admin: devolve o estoque, apaga a venda e os sale_items (venda direta)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const admin = await c.userId('admin')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      // Funcionário registra a venda (baixa o estoque de 100 -> 97).
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 3 }])
      const sale = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [items],
      )

      const estoqueAntes = await c.val<string>(
        `select estoque_atual from public.products where id = $1`,
        [prod],
      )
      expect(Number(estoqueAntes)).toBe(97)

      // Admin exclui a venda: estoque restaurado (+3), venda e sale_items somem.
      await c.asUser(admin)
      await c.rpc('excluir_venda', { p_sale_id: sale!.id })

      const estoqueDepois = await c.val<string>(
        `select estoque_atual from public.products where id = $1`,
        [prod],
      )
      expect(Number(estoqueDepois)).toBe(100)

      const nSales = await c.val<string>(`select count(*) from public.sales where id = $1`, [
        sale!.id,
      ])
      expect(Number(nSales)).toBe(0)

      const nItems = await c.val<string>(
        `select count(*) from public.sale_items where sale_id = $1`,
        [sale!.id],
      )
      expect(Number(nItems)).toBe(0)
    })
  })

  it('SÓ admin: venda vinda de COMANDA também apaga a comanda e o movimento de estoque dela', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const admin = await c.userId('admin')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      // Funcionário: abre comanda, adiciona item (baixa estoque 100 -> 97 já na adição),
      // depois fecha a comanda gerando a venda.
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const comandaId = await c.val<string>(`select id from public.abrir_comanda('Mesa 1')`)
      await c.rpc('adicionar_item_comanda', {
        p_comanda_id: comandaId,
        p_product_id: prod,
        p_quantidade: 3,
      })
      const sale = await c.one<{ id: string }>(
        `select * from public.fechar_comanda($1::uuid, 'dinheiro', 0, null)`,
        [comandaId],
      )

      // O movimento de estoque da comanda referencia o comanda_id (não o sale_id).
      const movRef = await c.val<string>(
        `select count(*) from public.stock_movements where referencia_id = $1`,
        [comandaId],
      )
      expect(Number(movRef)).toBe(1)
      const estoqueAntes = await c.val<string>(
        `select estoque_atual from public.products where id = $1`,
        [prod],
      )
      expect(Number(estoqueAntes)).toBe(97)

      // Admin exclui a venda: estoque volta a 100, comanda somem e o movimento dela também.
      await c.asUser(admin)
      await c.rpc('excluir_venda', { p_sale_id: sale!.id })

      const estoqueDepois = await c.val<string>(
        `select estoque_atual from public.products where id = $1`,
        [prod],
      )
      expect(Number(estoqueDepois)).toBe(100)

      const nComanda = await c.val<string>(
        `select count(*) from public.comandas where id = $1`,
        [comandaId],
      )
      expect(Number(nComanda)).toBe(0)

      const nMov = await c.val<string>(
        `select count(*) from public.stock_movements where referencia_id = $1`,
        [comandaId],
      )
      expect(Number(nMov)).toBe(0)

      const nSales = await c.val<string>(`select count(*) from public.sales where id = $1`, [
        sale!.id,
      ])
      expect(Number(nSales)).toBe(0)
    })
  })

  it('funcionário NÃO pode excluir venda', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 1 }])
      const sale = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [items],
      )

      // Estoque baixou de 100 -> 99 ao registrar a venda; guardamos para provar que NÃO muda.
      const estoqueAntes = await c.val<string>(
        `select estoque_atual from public.products where id = $1`,
        [prod],
      )
      expect(Number(estoqueAntes)).toBe(99)

      await esperaErroPreservandoTx(
        c,
        () => c.q(`select public.excluir_venda($1::uuid)`, [sale!.id]),
        /administradora/i,
      )

      // Invariante de segurança: barrado ANTES de qualquer mutação — nada mudou.
      const nSales = await c.val<string>(`select count(*) from public.sales where id = $1`, [
        sale!.id,
      ])
      expect(Number(nSales)).toBe(1)

      const nItems = await c.val<string>(
        `select count(*) from public.sale_items where sale_id = $1`,
        [sale!.id],
      )
      expect(Number(nItems)).toBe(1)

      const estoqueDepois = await c.val<string>(
        `select estoque_atual from public.products where id = $1`,
        [prod],
      )
      expect(Number(estoqueDepois)).toBe(99)
    })
  })

  it('ANON não pode excluir venda (barrado por is_admin) e a venda continua intacta', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 1 }])
      const sale = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [items],
      )

      await c.asAnon()
      await esperaErroPreservandoTx(
        c,
        () => c.q(`select public.excluir_venda($1::uuid)`, [sale!.id]),
        /administradora/i,
      )

      // A venda segue existindo (nada foi apagado sob o papel anônimo).
      await c.asSuperuser()
      const nSales = await c.val<string>(`select count(*) from public.sales where id = $1`, [
        sale!.id,
      ])
      expect(Number(nSales)).toBe(1)
    })
  })
})

describe('excluir_movimento_estoque', () => {
  it('SÓ admin: estorna o saldo (estoque -= quantidade) e apaga o movimento', async () => {
    await tx(async (c) => {
      const admin = await c.userId('admin')
      const prod = await criarProduto(c, { estoque_atual: 50 })

      // Admin lança uma entrada de +10 (50 -> 60).
      await c.asUser(admin)
      const mov = await c.one<{ id: string }>(
        `select * from public.registrar_movimento_estoque($1::uuid, 'entrada'::movement_type, 10, 'Reposição')`,
        [prod],
      )
      const estoqueAntes = await c.val<string>(
        `select estoque_atual from public.products where id = $1`,
        [prod],
      )
      expect(Number(estoqueAntes)).toBe(60)

      // Admin exclui o movimento: estoque volta (60 - 10 = 50) e o movimento some.
      await c.rpc('excluir_movimento_estoque', { p_id: mov!.id })

      const estoqueDepois = await c.val<string>(
        `select estoque_atual from public.products where id = $1`,
        [prod],
      )
      expect(Number(estoqueDepois)).toBe(50)

      const nMov = await c.val<string>(
        `select count(*) from public.stock_movements where id = $1`,
        [mov!.id],
      )
      expect(Number(nMov)).toBe(0)
    })
  })

  it('funcionário NÃO pode excluir movimento de estoque', async () => {
    await tx(async (c) => {
      const admin = await c.userId('admin')
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { estoque_atual: 50 })

      await c.asUser(admin)
      const mov = await c.one<{ id: string }>(
        `select * from public.registrar_movimento_estoque($1::uuid, 'entrada'::movement_type, 10, 'Reposição')`,
        [prod],
      )
      // Entrada de +10 (50 -> 60); guardamos para provar que NÃO estorna quando barrado.
      const estoqueAntes = await c.val<string>(
        `select estoque_atual from public.products where id = $1`,
        [prod],
      )
      expect(Number(estoqueAntes)).toBe(60)

      await c.asUser(func)
      await esperaErroPreservandoTx(
        c,
        () => c.q(`select public.excluir_movimento_estoque($1::uuid)`, [mov!.id]),
        /administradora/i,
      )

      // Invariante de segurança: barrado ANTES de mutar — movimento e estoque intactos.
      const nMov = await c.val<string>(
        `select count(*) from public.stock_movements where id = $1`,
        [mov!.id],
      )
      expect(Number(nMov)).toBe(1)

      const estoqueDepois = await c.val<string>(
        `select estoque_atual from public.products where id = $1`,
        [prod],
      )
      expect(Number(estoqueDepois)).toBe(60)
    })
  })

  it('admin: p_id INEXISTENTE cai no branch "não encontrado"', async () => {
    await tx(async (c) => {
      const admin = await c.userId('admin')
      await c.asUser(admin)
      await c.expectError(
        () =>
          c.q(`select public.excluir_movimento_estoque('00000000-0000-0000-0000-000000000000'::uuid)`),
        /não encontrado/i,
      )
    })
  })
})

describe('excluir_movimento_caixa', () => {
  it('SÓ admin: apaga o movimento de caixa', async () => {
    await tx(async (c) => {
      const admin = await c.userId('admin')

      // Admin abre o caixa e registra um suprimento.
      await c.asUser(admin)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const mov = await c.one<{ id: string }>(
        `select * from public.registrar_movimento_caixa('suprimento'::cash_movement_type, 30, 'Troco inicial')`,
      )

      const antes = await c.val<string>(
        `select count(*) from public.cash_movements where id = $1`,
        [mov!.id],
      )
      expect(Number(antes)).toBe(1)

      await c.rpc('excluir_movimento_caixa', { p_id: mov!.id })

      const depois = await c.val<string>(
        `select count(*) from public.cash_movements where id = $1`,
        [mov!.id],
      )
      expect(Number(depois)).toBe(0)
    })
  })

  it('funcionário NÃO pode excluir movimento de caixa', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')

      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const mov = await c.one<{ id: string }>(
        `select * from public.registrar_movimento_caixa('suprimento'::cash_movement_type, 30, 'Troco inicial')`,
      )

      await esperaErroPreservandoTx(
        c,
        () => c.q(`select public.excluir_movimento_caixa($1::uuid)`, [mov!.id]),
        /administradora/i,
      )

      // Invariante de segurança: barrado ANTES de apagar — o movimento continua lá.
      const nMov = await c.val<string>(
        `select count(*) from public.cash_movements where id = $1`,
        [mov!.id],
      )
      expect(Number(nMov)).toBe(1)
    })
  })
})

describe('triggers append-only (DELETE direto)', () => {
  // O trigger forbid_update_delete protege sale_items/stock_movements/cash_movements:
  //   - se quem apaga NÃO é admin  -> raise 'Registros de X são imutáveis (append-only)...'
  //   - se é admin                 -> return old (deixa apagar)
  // Na produção, um funcionário nunca chega no trigger: não há policy de DELETE nessas
  // tabelas, então a RLS já barra o DELETE (0 linhas afetadas). Testamos os DOIS guardas:
  //   1) a RLS (funcionário: DELETE não afeta nada);
  //   2) o trigger em si (bypassando RLS via superuser e controlando is_admin() pelas claims).

  /** Fica como superusuário (RLS off) mas com as claims de `usuario`, para exercitar o trigger. */
  async function comoTriggerDe(c: Awaited<Parameters<Parameters<typeof tx>[0]>[0]>, usuario: string) {
    const id = await c.userId(usuario)
    await c.asSuperuser()
    await c.q("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: id, role: 'authenticated' }),
    ])
  }

  it('RLS: funcionário não consegue DELETE direto em sale_items (não afeta linhas e não some)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 1 }])
      const sale = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [items],
      )

      // Não há policy de DELETE -> a RLS não deixa apagar (0 linhas) e o item continua lá.
      const r = await c.q(`delete from public.sale_items where sale_id = $1`, [sale!.id])
      expect(r.rowCount).toBe(0)
      const n = await c.val<string>(
        `select count(*) from public.sale_items where sale_id = $1`,
        [sale!.id],
      )
      expect(Number(n)).toBe(1)
    })
  })

  it('trigger: quem NÃO é admin é barrado ao apagar sale_items (append-only)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 1 }])
      const sale = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [items],
      )

      // Bypassa a RLS (superuser) com as claims do funcionário -> is_admin()=false -> trigger barra.
      await comoTriggerDe(c, 'funcionario')
      await c.expectError(
        () => c.q(`delete from public.sale_items where sale_id = $1`, [sale!.id]),
        /imutáveis|append-only|administradora/i,
      )
    })
  })

  it('trigger: quem NÃO é admin é barrado ao apagar stock_movements (append-only)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 1 }])
      const sale = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [items],
      )

      await comoTriggerDe(c, 'funcionario')
      await c.expectError(
        () => c.q(`delete from public.stock_movements where referencia_id = $1`, [sale!.id]),
        /imutáveis|append-only|administradora/i,
      )
    })
  })

  it('trigger: quem NÃO é admin é barrado ao apagar cash_movements (append-only)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')

      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const mov = await c.one<{ id: string }>(
        `select * from public.registrar_movimento_caixa('suprimento'::cash_movement_type, 30, 'Troco')`,
      )

      await comoTriggerDe(c, 'funcionario')
      await c.expectError(
        () => c.q(`delete from public.cash_movements where id = $1`, [mov!.id]),
        /imutáveis|append-only|administradora/i,
      )
    })
  })

  it('trigger: ADMIN pode DELETE direto em sale_items (trigger retorna old)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      // Funcionário cria a venda...
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 1 }])
      const sale = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [items],
      )

      // ...e a administradora corrige o dado errado apagando o item (trigger deixa passar).
      await comoTriggerDe(c, 'admin')
      const r = await c.q(`delete from public.sale_items where sale_id = $1`, [sale!.id])
      expect(r.rowCount).toBe(1)

      const n = await c.val<string>(
        `select count(*) from public.sale_items where sale_id = $1`,
        [sale!.id],
      )
      expect(Number(n)).toBe(0)
    })
  })

  it('trigger: ADMIN pode DELETE direto em stock_movements (trigger retorna old)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      // Funcionário cria a venda, gerando o movimento de estoque...
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 1 }])
      const sale = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [items],
      )

      // ...e a administradora apaga o movimento direto (trigger deixa passar).
      await comoTriggerDe(c, 'admin')
      const r = await c.q(`delete from public.stock_movements where referencia_id = $1`, [sale!.id])
      expect(r.rowCount).toBe(1)

      const n = await c.val<string>(
        `select count(*) from public.stock_movements where referencia_id = $1`,
        [sale!.id],
      )
      expect(Number(n)).toBe(0)
    })
  })

  it('trigger: ADMIN pode DELETE direto em cash_movements (trigger retorna old)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')

      // Funcionário registra um movimento de caixa...
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const mov = await c.one<{ id: string }>(
        `select * from public.registrar_movimento_caixa('suprimento'::cash_movement_type, 30, 'Troco')`,
      )

      // ...e a administradora apaga o movimento direto (trigger deixa passar).
      await comoTriggerDe(c, 'admin')
      const r = await c.q(`delete from public.cash_movements where id = $1`, [mov!.id])
      expect(r.rowCount).toBe(1)

      const n = await c.val<string>(
        `select count(*) from public.cash_movements where id = $1`,
        [mov!.id],
      )
      expect(Number(n)).toBe(0)
    })
  })
})
