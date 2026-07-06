import { describe, it, expect } from 'vitest'
import { tx, criarProduto } from '../helpers/db'

// Regras de negócio das ENCOMENDAS (criar_encomenda / mudar_status_encomenda /
// excluir_encomenda) e da view de Contas a Receber (vw_contas_receber).
// Cada teste roda numa transação revertida no fim — nada é gravado de verdade.

describe('criar_encomenda', () => {
  it('cria encomenda a partir de itens do catálogo e calcula subtotal/total no servidor', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      // 3 x 4.50 = 13.50 de subtotal; sem taxa e sem total => total = subtotal.
      const items = JSON.stringify([
        { product_id: prod, product_nome: 'Coxinha', quantidade: 3, preco_unitario: 4.5 },
      ])
      const order = await c.one<{
        id: string
        subtotal: string
        total: string
        status: string
        origem: string
        cliente_nome: string
      }>(`select * from public.criar_encomenda($1, $2::jsonb)`, ['Dona Cliente', items])

      expect(Number(order!.subtotal)).toBe(13.5)
      expect(Number(order!.total)).toBe(13.5)
      expect(order!.status).toBe('pendente')
      expect(order!.origem).toBe('balcao')
      expect(order!.cliente_nome).toBe('Dona Cliente')

      // Os itens do catálogo viram order_items.
      const nItens = await c.val<string>(
        `select count(*) from public.order_items where order_id = $1`,
        [order!.id],
      )
      expect(Number(nItens)).toBe(1)
    })
  })

  it('soma a taxa de entrega ao subtotal quando não há total informado', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10 })

      await c.asUser(func)
      // 2 x 5 = 10 de subtotal + 7 de taxa => total 17.
      const items = JSON.stringify([
        { product_id: prod, product_nome: 'Kibe', quantidade: 2, preco_unitario: 5 },
      ])
      const order = await c.one<{ subtotal: string; total: string; taxa_entrega: string }>(
        `select * from public.criar_encomenda($1, $2::jsonb, null, null, null, null, 'entrega'::delivery_type, $3, 7)`,
        ['Cliente Entrega', items, 'Rua das Flores, 123'],
      )
      expect(Number(order!.subtotal)).toBe(10)
      expect(Number(order!.taxa_entrega)).toBe(7)
      expect(Number(order!.total)).toBe(17)
    })
  })

  it('aceita descrição livre com total editável (sem itens do catálogo)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)

      // Sem itens, mas com descrição e total editável = 250.
      const order = await c.one<{ id: string; subtotal: string; total: string; descricao: string }>(
        `select * from public.criar_encomenda($1, '[]'::jsonb, 250, null, $2)`,
        ['Festa da Maria', 'Bolo grande + 100 salgados sortidos'],
      )
      expect(Number(order!.subtotal)).toBe(0)
      expect(Number(order!.total)).toBe(250)
      expect(order!.descricao).toBe('Bolo grande + 100 salgados sortidos')

      // Descrição livre não gera order_items.
      const nItens = await c.val<string>(
        `select count(*) from public.order_items where order_id = $1`,
        [order!.id],
      )
      expect(Number(nItens)).toBe(0)
    })
  })

  it('NÃO baixa estoque e NÃO cria venda nem movimento ao criar encomenda', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 50 })

      await c.asUser(func)

      // SNAPSHOT antes: nº de vendas e de movimentos de estoque (globais) devem
      // ficar iguais depois. Contar por referencia_id/funcionario_id da própria
      // encomenda seria tautológico (0 por construção), então tiramos um retrato
      // global e exigimos delta 0.
      const vendasAntes = await c.val<string>(`select count(*) from public.sales`)
      const movsAntes = await c.val<string>(`select count(*) from public.stock_movements`)

      const items = JSON.stringify([
        { product_id: prod, product_nome: 'Empada', quantidade: 4, preco_unitario: 10 },
      ])
      const order = await c.one<{ id: string }>(
        `select * from public.criar_encomenda($1, $2::jsonb)`,
        ['Cliente Estoque', items],
      )

      // Estoque intacto.
      const estoque = await c.val<string>(`select estoque_atual from public.products where id = $1`, [prod])
      expect(Number(estoque)).toBe(50)

      // SNAPSHOT depois: nenhuma venda e nenhum movimento de estoque criados.
      const vendasDepois = await c.val<string>(`select count(*) from public.sales`)
      const movsDepois = await c.val<string>(`select count(*) from public.stock_movements`)
      expect(Number(vendasDepois) - Number(vendasAntes)).toBe(0)
      expect(Number(movsDepois) - Number(movsAntes)).toBe(0)

      // Reforço direcionado: nenhum movimento tocou ESTE produto de teste.
      const movsProduto = await c.val<string>(
        `select count(*) from public.stock_movements where product_id = $1`,
        [prod],
      )
      expect(Number(movsProduto)).toBe(0)

      // E nada referencia a própria encomenda.
      const nMov = await c.val<string>(
        `select count(*) from public.stock_movements where referencia_id = $1`,
        [order!.id],
      )
      expect(Number(nMov)).toBe(0)
    })
  })

  it('exige o nome do cliente', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)
      await c.expectError(
        () => c.q(`select public.criar_encomenda($1, '[]'::jsonb, 100)`, ['   ']),
        /nome do cliente/i,
      )
    })
  })

  it('recusa encomenda sem itens, sem total e sem descrição', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)
      await c.expectError(
        () => c.q(`select public.criar_encomenda($1, '[]'::jsonb, null, null, null)`, ['Cliente Vazio']),
        /itens, um valor total ou uma descri/i,
      )
    })
  })

  it('recusa usuário anônimo (não autenticado)', async () => {
    await tx(async (c) => {
      await c.asAnon()
      await c.expectError(
        () => c.q(`select public.criar_encomenda($1, '[]'::jsonb, 100)`, ['Cliente Anon']),
        /inativo ou não autenticado/i,
      )
    })
  })
})

describe('mudar_status_encomenda', () => {
  it('faz a transição pendente -> entregue -> pago e grava a forma de pagamento', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)

      const order = await c.one<{ id: string; status: string }>(
        `select * from public.criar_encomenda($1, '[]'::jsonb, 60)`,
        ['Cliente Fluxo'],
      )
      expect(order!.status).toBe('pendente')

      // pendente -> entregue
      const entregue = await c.one<{ status: string; data_entrega: string | null }>(
        `select * from public.mudar_status_encomenda($1, 'entregue'::order_status)`,
        [order!.id],
      )
      expect(entregue!.status).toBe('entregue')
      expect(entregue!.data_entrega).not.toBeNull()

      // entregue -> pago (com forma de pagamento)
      const pago = await c.one<{ status: string; forma_pagamento: string; data_pagamento: string | null }>(
        `select * from public.mudar_status_encomenda($1, 'pago'::order_status, 'pix'::order_payment_method)`,
        [order!.id],
      )
      expect(pago!.status).toBe('pago')
      expect(pago!.forma_pagamento).toBe('pix')
      expect(pago!.data_pagamento).not.toBeNull()
    })
  })

  it('exige a forma de pagamento ao marcar como pago', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)

      const order = await c.one<{ id: string }>(
        `select * from public.criar_encomenda($1, '[]'::jsonb, 90)`,
        ['Cliente Sem Forma'],
      )

      // pendente -> entregue
      await c.q(`select public.mudar_status_encomenda($1, 'entregue'::order_status)`, [order!.id])

      // entregue -> pago SEM p_forma_pagamento => erro.
      await c.expectError(
        () => c.q(`select public.mudar_status_encomenda($1, 'pago'::order_status)`, [order!.id]),
        /forma de pagamento/i,
      )
    })
  })

  it('não permite mudar o status de uma encomenda já paga', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)

      const order = await c.one<{ id: string }>(
        `select * from public.criar_encomenda($1, '[]'::jsonb, 40)`,
        ['Cliente Pago'],
      )
      await c.q(`select public.mudar_status_encomenda($1, 'pago'::order_status, 'dinheiro'::order_payment_method)`, [
        order!.id,
      ])

      await c.expectError(
        () => c.q(`select public.mudar_status_encomenda($1, 'entregue'::order_status)`, [order!.id]),
        /não pode mudar de status/i,
      )
    })
  })

  it('recusa encomenda inexistente', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)
      await c.expectError(
        () =>
          c.q(`select public.mudar_status_encomenda('00000000-0000-0000-0000-000000000000'::uuid, 'entregue'::order_status)`),
        /não encontrada/i,
      )
    })
  })
})

describe('vw_contas_receber (Contas a receber)', () => {
  it('encomenda ENTREGUE e não paga aparece; ao marcar paga, sai da view', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)

      const order = await c.one<{ id: string }>(
        `select * from public.criar_encomenda($1, '[]'::jsonb, 120)`,
        ['Cliente A Receber'],
      )

      // Pendente ainda não aparece em contas a receber.
      const antes = await c.val<string>(
        `select count(*) from public.vw_contas_receber where id = $1`,
        [order!.id],
      )
      expect(Number(antes)).toBe(0)

      // Marcar entregue (não pago) => aparece.
      await c.q(`select public.mudar_status_encomenda($1, 'entregue'::order_status)`, [order!.id])
      const receber = await c.one<{ id: string; total: string }>(
        `select id, total from public.vw_contas_receber where id = $1`,
        [order!.id],
      )
      expect(receber).toBeTruthy()
      expect(Number(receber!.total)).toBe(120)

      // Marcar pago => sai da view.
      await c.q(`select public.mudar_status_encomenda($1, 'pago'::order_status, 'dinheiro'::order_payment_method)`, [
        order!.id,
      ])
      const depois = await c.val<string>(
        `select count(*) from public.vw_contas_receber where id = $1`,
        [order!.id],
      )
      expect(Number(depois)).toBe(0)
    })
  })

  it('marca como vencida quando a data prevista de pagamento já passou', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)

      // Encomenda com data prevista de pagamento no passado.
      const order = await c.one<{ id: string }>(
        `select * from public.criar_encomenda($1, '[]'::jsonb, 80, null, null, null, 'retirada'::delivery_type, null, 0, null, null, (current_date - 5))`,
        ['Cliente Vencido'],
      )
      await c.q(`select public.mudar_status_encomenda($1, 'entregue'::order_status)`, [order!.id])

      const row = await c.one<{ vencido: boolean; dias_para_vencer: number }>(
        `select vencido, dias_para_vencer from public.vw_contas_receber where id = $1`,
        [order!.id],
      )
      expect(row!.vencido).toBe(true)
      expect(Number(row!.dias_para_vencer)).toBe(-5)
    })
  })
})

describe('excluir_encomenda', () => {
  it('a administradora (admin) consegue excluir a encomenda', async () => {
    await tx(async (c) => {
      const admin = await c.userId('admin')
      await c.asUser(admin)

      const order = await c.one<{ id: string }>(
        `select * from public.criar_encomenda($1, '[]'::jsonb, 30)`,
        ['Cliente Excluir'],
      )
      await c.q(`select public.excluir_encomenda($1)`, [order!.id])

      const n = await c.val<string>(`select count(*) from public.orders where id = $1`, [order!.id])
      expect(Number(n)).toBe(0)
    })
  })

  it('funcionário NÃO pode excluir encomenda (admin-only)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)

      const order = await c.one<{ id: string }>(
        `select * from public.criar_encomenda($1, '[]'::jsonb, 30)`,
        ['Cliente Protegido'],
      )
      await c.expectError(
        () => c.q(`select public.excluir_encomenda($1)`, [order!.id]),
        /administradora pode excluir/i,
      )
    })
  })
})
