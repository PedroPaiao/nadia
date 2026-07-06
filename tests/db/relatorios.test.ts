import { describe, it, expect } from 'vitest'
import { tx, criarProduto } from '../helpers/db'

// Regras de negócio do domínio RELATÓRIOS (relatorio_totais / relatorio_produtos_vendidos
// / relatorio_vendas_por_dia / relatorio_vendas_resumo).
//
// Cada teste roda numa transação revertida no fim — nada é gravado de verdade.
//
// Cenário determinístico (montado em cada teste): funcionário 'funcionario' abre o caixa e
// registra 2 vendas conhecidas, no MESMO instante ("agora"), sem desconto, com produtos
// de preço e custo conhecidos:
//
//   Produto A: preco_venda = 10, custo = 4
//   Produto B: preco_venda =  8, custo = 5
//
//   Venda 1 (dinheiro): 3x A                 -> subtotal/total = 30
//   Venda 2 (pix):      2x B + 1x A          -> subtotal/total = 8*2 + 10*1 = 26
//
// Consolidado esperado:
//   Produto A: qtd 3+1 = 4  | total 40 | custo 4*4 = 16 | lucro 40-16 = 24
//   Produto B: qtd 2        | total 16 | custo 2*5 = 10 | lucro 16-10 =  6
//   Receita  = 30 + 26 = 56
//   Custo    = 16 + 10 = 26
//   Lucro    = 56 - 26 = 30
//   Qtd vendas = 2 -> ticket médio = 56 / 2 = 28

/** Monta o cenário canônico e devolve os ids relevantes + a janela de tempo. */
async function montarCenario(c: Parameters<Parameters<typeof tx>[0]>[0]) {
  const prodA = await criarProduto(c, { preco_venda: 10, custo: 4, estoque_atual: 100 })
  const prodB = await criarProduto(c, { preco_venda: 8, custo: 5, estoque_atual: 100 })

  const func = await c.userId('funcionario')
  await c.asUser(func)
  await c.rpc('abrir_caixa', { p_valor_abertura: 0 })

  // Venda 1: 3x A, dinheiro -> total 30
  const itens1 = JSON.stringify([{ product_id: prodA, quantidade: 3 }])
  const venda1 = await c.one<{ id: string }>(
    `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
    [itens1],
  )

  // Venda 2: 2x B + 1x A, pix -> total 26
  const itens2 = JSON.stringify([
    { product_id: prodB, quantidade: 2 },
    { product_id: prodA, quantidade: 1 },
  ])
  const venda2 = await c.one<{ id: string }>(
    `select * from public.registrar_venda($1::jsonb, 'pix', 0, null, null)`,
    [itens2],
  )

  // Janela DETERMINÍSTICA e independente da seed: derivada do created_at exato das
  // vendas que ACABAMOS de registrar. Como created_at default = now() (início da
  // transação), as duas vendas partilham o mesmo instante; usamos [min, max + 1s)
  // para pegar SÓ elas — nenhuma venda semeada (com created_at anterior) entra, e
  // o limite superior EXCLUSIVO (created_at < p_fim, ver prosrc) fica bem à frente
  // do instante das vendas. Como created_at = now() também garante que dia = hoje
  // (no fuso local), o relatorio_vendas_por_dia devolve exatamente uma linha.
  // Devolve como TEXTO ISO com precisão de microssegundo (to_char) para não perder
  // precisão no round-trip pelo Date do JS (que trunca em milissegundos). Cast de
  // volta para ::timestamptz na hora de chamar as RPCs. Também devolve `criadoEm`
  // (o created_at exato das vendas) para os testes de borda da janela.
  const janela = await c.one<{ inicio: string; fim: string; criadoEm: string }>(
    `select
       to_char(min(created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00"')                       as inicio,
       to_char((max(created_at) + interval '1 second') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00"') as fim,
       to_char(min(created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00"')                       as "criadoEm"
     from public.sales where id = any($1::uuid[])`,
    [[venda1!.id, venda2!.id]],
  )
  return {
    prodA,
    prodB,
    inicio: janela!.inicio,
    fim: janela!.fim,
    criadoEm: janela!.criadoEm,
  }
}

describe('relatorio_totais', () => {
  it('soma a receita, o custo e o lucro estimado das vendas concluídas', async () => {
    await tx(async (c) => {
      const { inicio, fim } = await montarCenario(c)

      const r = await c.one<{
        receita: string
        descontos: string
        custo: string
        lucro: string
        qtd_vendas: string
      }>(`select * from public.relatorio_totais($1::timestamptz, $2::timestamptz)`, [inicio, fim])

      // Receita = soma dos totais das vendas.
      expect(Number(r!.receita)).toBe(56)
      // Sem desconto no cenário.
      expect(Number(r!.descontos)).toBe(0)
      // Custo = soma(qtd * custo_unitario) = 16 (A) + 10 (B).
      expect(Number(r!.custo)).toBe(26)
      // Lucro = receita - custo = 56 - 26.
      expect(Number(r!.lucro)).toBe(30)
      // 2 vendas concluídas.
      expect(Number(r!.qtd_vendas)).toBe(2)
    })
  })

  it('calcula o ticket médio como receita / qtd_vendas', async () => {
    await tx(async (c) => {
      const { inicio, fim } = await montarCenario(c)

      const r = await c.one<{ ticket_medio: string }>(
        `select * from public.relatorio_totais($1::timestamptz, $2::timestamptz)`,
        [inicio, fim],
      )
      // 56 / 2 = 28.
      expect(Number(r!.ticket_medio)).toBe(28)
    })
  })

  it('zera todos os totais (e não divide por zero) quando não há vendas na janela', async () => {
    await tx(async (c) => {
      // Janela num futuro distante, garantidamente sem nenhuma venda (nem seed).
      await c.asSuperuser()
      const r = await c.one<{
        receita: string
        custo: string
        lucro: string
        qtd_vendas: string
        ticket_medio: string
      }>(
        `select * from public.relatorio_totais(
           '2099-01-01T00:00:00-03:00'::timestamptz,
           '2099-01-02T00:00:00-03:00'::timestamptz
         )`,
      )
      expect(Number(r!.receita)).toBe(0)
      expect(Number(r!.custo)).toBe(0)
      expect(Number(r!.lucro)).toBe(0)
      expect(Number(r!.qtd_vendas)).toBe(0)
      // Guard contra divisão por zero: ticket médio = 0.
      expect(Number(r!.ticket_medio)).toBe(0)
    })
  })

  it('conta vendas canceladas à parte, sem poluir receita/lucro', async () => {
    await tx(async (c) => {
      const { prodA, inicio, fim } = await montarCenario(c)

      // Registra uma 3ª venda e a cancela — não pode entrar na receita.
      const itens3 = JSON.stringify([{ product_id: prodA, quantidade: 5 }]) // total 50
      const venda3 = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [itens3],
      )
      await c.rpc('cancelar_venda', { p_sale_id: venda3!.id, p_motivo: 'teste' })

      const r = await c.one<{
        receita: string
        qtd_vendas: string
        canceladas_qtd: string
        canceladas_valor: string
      }>(`select * from public.relatorio_totais($1::timestamptz, $2::timestamptz)`, [inicio, fim])

      // Receita segue 56 (só as 2 concluídas).
      expect(Number(r!.receita)).toBe(56)
      expect(Number(r!.qtd_vendas)).toBe(2)
      // A cancelada aparece nas colunas de cancelamento.
      expect(Number(r!.canceladas_qtd)).toBe(1)
      expect(Number(r!.canceladas_valor)).toBe(50)
    })
  })

  it('trata a janela como [inicio, fim) — limite superior EXCLUSIVO', async () => {
    await tx(async (c) => {
      const { inicio, criadoEm } = await montarCenario(c)

      // fim EXATAMENTE igual ao created_at das vendas: como o prosrc usa
      // `created_at < p_fim`, nenhuma venda entra -> tudo zero.
      const foraExclusivo = await c.one<{ receita: string; qtd_vendas: string }>(
        `select * from public.relatorio_totais($1::timestamptz, $2::timestamptz)`,
        [inicio, criadoEm],
      )
      expect(Number(foraExclusivo!.qtd_vendas)).toBe(0)
      expect(Number(foraExclusivo!.receita)).toBe(0)
    })
  })

  it('inclui a venda quando inicio == created_at — limite inferior INCLUSIVO', async () => {
    await tx(async (c) => {
      const { criadoEm, fim } = await montarCenario(c)

      // inicio EXATAMENTE no created_at: como o prosrc usa `created_at >= p_inicio`,
      // as duas vendas entram -> receita 56, 2 vendas.
      const dentroInclusivo = await c.one<{ receita: string; qtd_vendas: string }>(
        `select * from public.relatorio_totais($1::timestamptz, $2::timestamptz)`,
        [criadoEm, fim],
      )
      expect(Number(dentroInclusivo!.qtd_vendas)).toBe(2)
      expect(Number(dentroInclusivo!.receita)).toBe(56)
    })
  })

  it('reflete o DESCONTO: receita = total com desconto e lucro = receita - custo', async () => {
    await tx(async (c) => {
      // Cenário isolado: 1 venda de 5x A (preco 10, custo 4) com desconto 8.
      //   subtotal = 50 | desconto = 8 | total(receita) = 42
      //   custo    = 5 * 4 = 20
      //   lucro    = 42 - 20 = 22
      const prodA = await criarProduto(c, { preco_venda: 10, custo: 4, estoque_atual: 100 })

      const func = await c.userId('funcionario')
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })

      const itens = JSON.stringify([{ product_id: prodA, quantidade: 5 }])
      const venda = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 8, null, null)`,
        [itens],
      )

      // Janela derivada do created_at exato desta venda (mesma técnica de montarCenario).
      const janela = await c.one<{ inicio: string; fim: string }>(
        `select
           to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00"')                       as inicio,
           to_char((created_at + interval '1 second') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00"') as fim
         from public.sales where id = $1`,
        [venda!.id],
      )

      const r = await c.one<{
        receita: string
        descontos: string
        custo: string
        lucro: string
        qtd_vendas: string
      }>(`select * from public.relatorio_totais($1::timestamptz, $2::timestamptz)`, [
        janela!.inicio,
        janela!.fim,
      ])

      expect(Number(r!.qtd_vendas)).toBe(1)
      // Desconto conhecido é agregado em `descontos`.
      expect(Number(r!.descontos)).toBe(8)
      // Receita = total (subtotal - desconto) = 42.
      expect(Number(r!.receita)).toBe(42)
      // Custo vem dos sale_items (não afetado pelo desconto) = 5 * 4.
      expect(Number(r!.custo)).toBe(20)
      // Lucro coerente = receita - custo = 42 - 20.
      expect(Number(r!.lucro)).toBe(22)
    })
  })
})

describe('relatorio_produtos_vendidos', () => {
  it('agrega quantidade, total, custo e lucro por produto (com nome)', async () => {
    await tx(async (c) => {
      const { prodA, prodB, inicio, fim } = await montarCenario(c)

      // Nomes reais gravados nos produtos, para asserir product_nome sem hardcode frágil.
      await c.asSuperuser()
      const nomeA = await c.val<string>(`select nome from public.products where id = $1`, [prodA])
      const nomeB = await c.val<string>(`select nome from public.products where id = $1`, [prodB])

      const linhas = await c.q(
        `select * from public.relatorio_produtos_vendidos($1::timestamptz, $2::timestamptz, 20)`,
        [inicio, fim],
      )
      const porId = new Map(linhas.rows.map((l) => [l.product_id, l]))

      // Produto A: vendido 3 + 1 = 4 unidades.
      const a = porId.get(prodA)!
      expect(a.product_nome).toBe(nomeA) // o relatório expõe o nome, não só o id
      expect(Number(a.quantidade)).toBe(4)
      expect(Number(a.total)).toBe(40) // 4 * 10
      expect(Number(a.custo)).toBe(16) // 4 * 4
      expect(Number(a.lucro)).toBe(24) // 40 - 16

      // Produto B: vendido 2 unidades.
      const b = porId.get(prodB)!
      expect(b.product_nome).toBe(nomeB)
      expect(Number(b.quantidade)).toBe(2)
      expect(Number(b.total)).toBe(16) // 2 * 8
      expect(Number(b.custo)).toBe(10) // 2 * 5
      expect(Number(b.lucro)).toBe(6) // 16 - 10
    })
  })

  it('ordena por quantidade desc — o mais vendido vem primeiro', async () => {
    await tx(async (c) => {
      const { prodA, inicio, fim } = await montarCenario(c)

      const linhas = await c.q(
        `select * from public.relatorio_produtos_vendidos($1::timestamptz, $2::timestamptz, 20)`,
        [inicio, fim],
      )
      // A (4 un) foi mais vendido que B (2 un), então vem primeiro.
      expect(linhas.rows[0].product_id).toBe(prodA)
    })
  })

  it('p_limite recorta o resultado — limite 1 devolve só o mais vendido', async () => {
    await tx(async (c) => {
      const { prodA, inicio, fim } = await montarCenario(c)

      // Com limite 1, o prosrc faz `limit greatest(1, 1)` -> exatamente 1 linha,
      // e a ordenação por quantidade desc garante que é o produto A (4 un).
      const linhas = await c.q(
        `select * from public.relatorio_produtos_vendidos($1::timestamptz, $2::timestamptz, 1)`,
        [inicio, fim],
      )
      expect(linhas.rows.length).toBe(1)
      expect(linhas.rows[0].product_id).toBe(prodA)
      expect(Number(linhas.rows[0].quantidade)).toBe(4)
    })
  })

  it('exclui vendas CANCELADAS — quantidade/total do produto não contam a cancelada', async () => {
    await tx(async (c) => {
      const { prodA, prodB, inicio, fim } = await montarCenario(c)

      // 3ª venda: 10x A (subtotal 100), depois CANCELADA. Não pode entrar no relatório.
      const itens3 = JSON.stringify([{ product_id: prodA, quantidade: 10 }])
      const venda3 = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [itens3],
      )
      await c.rpc('cancelar_venda', { p_sale_id: venda3!.id, p_motivo: 'teste' })

      const linhas = await c.q(
        `select * from public.relatorio_produtos_vendidos($1::timestamptz, $2::timestamptz, 20)`,
        [inicio, fim],
      )
      const porId = new Map(linhas.rows.map((l) => [l.product_id, l]))

      // A segue com 4 un / total 40 — a cancelada (10 un / 100) NÃO entra.
      const a = porId.get(prodA)!
      expect(Number(a.quantidade)).toBe(4)
      expect(Number(a.total)).toBe(40)
      // B inalterado.
      const b = porId.get(prodB)!
      expect(Number(b.quantidade)).toBe(2)
      expect(Number(b.total)).toBe(16)
    })
  })
})

describe('relatorio_vendas_por_dia', () => {
  it('soma o total do dia das vendas concluídas', async () => {
    await tx(async (c) => {
      const { inicio, fim } = await montarCenario(c)

      const linhas = await c.q(
        `select * from public.relatorio_vendas_por_dia($1::timestamptz, $2::timestamptz)`,
        [inicio, fim],
      )
      // Tudo no mesmo dia -> uma única linha.
      expect(linhas.rows.length).toBe(1)
      expect(Number(linhas.rows[0].qtd_vendas)).toBe(2)
      expect(Number(linhas.rows[0].total)).toBe(56)
    })
  })

  it('não conta vendas CANCELADAS no total do dia', async () => {
    await tx(async (c) => {
      const { prodA, inicio, fim } = await montarCenario(c)

      // 3ª venda (5x A = 50) cancelada — não pode mexer no total do dia.
      const itens3 = JSON.stringify([{ product_id: prodA, quantidade: 5 }])
      const venda3 = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [itens3],
      )
      await c.rpc('cancelar_venda', { p_sale_id: venda3!.id, p_motivo: 'teste' })

      const linhas = await c.q(
        `select * from public.relatorio_vendas_por_dia($1::timestamptz, $2::timestamptz)`,
        [inicio, fim],
      )
      // Segue uma linha, com as 2 concluídas -> qtd 2, total 56 (a cancelada some).
      expect(linhas.rows.length).toBe(1)
      expect(Number(linhas.rows[0].qtd_vendas)).toBe(2)
      expect(Number(linhas.rows[0].total)).toBe(56)
    })
  })
})

describe('relatorio_vendas_resumo', () => {
  it('agrupa a receita por forma de pagamento', async () => {
    await tx(async (c) => {
      const { inicio, fim } = await montarCenario(c)

      const linhas = await c.q(
        `select * from public.relatorio_vendas_resumo($1::timestamptz, $2::timestamptz)`,
        [inicio, fim],
      )
      const porForma = new Map(linhas.rows.map((l) => [l.forma_pagamento, l]))

      // Venda 1 foi em dinheiro (total 30).
      const dinheiro = porForma.get('dinheiro')!
      expect(Number(dinheiro.qtd_vendas)).toBe(1)
      expect(Number(dinheiro.total)).toBe(30)

      // Venda 2 foi em pix (total 26).
      const pix = porForma.get('pix')!
      expect(Number(pix.qtd_vendas)).toBe(1)
      expect(Number(pix.total)).toBe(26)

      // Só existem essas duas formas de pagamento na janela.
      expect(linhas.rows.length).toBe(2)
    })
  })

  it('não conta vendas CANCELADAS no resumo por forma de pagamento', async () => {
    await tx(async (c) => {
      const { prodA, inicio, fim } = await montarCenario(c)

      // 3ª venda em dinheiro (5x A = 50) cancelada — não pode inflar o dinheiro.
      const itens3 = JSON.stringify([{ product_id: prodA, quantidade: 5 }])
      const venda3 = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [itens3],
      )
      await c.rpc('cancelar_venda', { p_sale_id: venda3!.id, p_motivo: 'teste' })

      const linhas = await c.q(
        `select * from public.relatorio_vendas_resumo($1::timestamptz, $2::timestamptz)`,
        [inicio, fim],
      )
      const porForma = new Map(linhas.rows.map((l) => [l.forma_pagamento, l]))

      // Dinheiro segue com a venda 1 apenas (30) — a cancelada NÃO conta.
      const dinheiro = porForma.get('dinheiro')!
      expect(Number(dinheiro.qtd_vendas)).toBe(1)
      expect(Number(dinheiro.total)).toBe(30)
      // Pix inalterado.
      const pix = porForma.get('pix')!
      expect(Number(pix.qtd_vendas)).toBe(1)
      expect(Number(pix.total)).toBe(26)
      expect(linhas.rows.length).toBe(2)
    })
  })
})
