import { describe, it, expect } from 'vitest'
import { tx, criarProduto } from '../helpers/db'

// Regras de negócio mais importantes da VENDA (registrar_venda / cancelar_venda).
// Cada teste roda numa transação revertida no fim — nada é gravado de verdade.

describe('registrar_venda', () => {
  it('recalcula o preço no SERVIDOR e ignora qualquer preço enviado pelo cliente', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 150 })

      // O cliente tenta forjar preco=1 centavo; o servidor deve usar 10.
      const items = JSON.stringify([{ product_id: prod, quantidade: 3, preco: 0.01 }])
      const sale = await c.one<{ total: string; subtotal: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [items],
      )
      expect(Number(sale!.subtotal)).toBe(30)
      expect(Number(sale!.total)).toBe(30)
    })
  })

  it('baixa o estoque na quantidade vendida e cria o movimento de estoque', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 8, estoque_atual: 50 })

      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 100 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 4 }])
      const sale = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [items],
      )

      const estoque = await c.val<string>(`select estoque_atual from public.products where id = $1`, [prod])
      expect(Number(estoque)).toBe(46)

      const mov = await c.one<{ quantidade: string; tipo: string; referencia_id: string }>(
        `select quantidade, tipo, referencia_id from public.stock_movements where referencia_id = $1`,
        [sale!.id],
      )
      expect(Number(mov!.quantidade)).toBe(-4)
      expect(mov!.tipo).toBe('venda')
    })
  })

  it('NÃO cria movimento de estoque para produto que não controla estoque', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { controla_estoque: false, estoque_atual: 0 })

      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 2 }])
      const sale = await c.one<{ id: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [items],
      )
      const n = await c.val<string>(
        `select count(*) from public.stock_movements where referencia_id = $1`,
        [sale!.id],
      )
      expect(Number(n)).toBe(0)
    })
  })

  it('exige um caixa ABERTO — sem caixa, a venda é recusada', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c)
      await c.asUser(func)
      // Sem abrir caixa:
      const items = JSON.stringify([{ product_id: prod, quantidade: 1 }])
      await c.expectError(
        () => c.q(`select public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`, [items]),
        /caixa aberto/i,
      )
    })
  })

  it('recusa desconto maior que o subtotal', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10 })
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 1 }])
      await c.expectError(
        () => c.q(`select public.registrar_venda($1::jsonb, 'dinheiro', 999, null, null)`, [items]),
        /desconto/i,
      )
    })
  })

  it('recusa produto inativo', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { ativo: false })
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 1 }])
      await c.expectError(
        () => c.q(`select public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`, [items]),
        /inativo/i,
      )
    })
  })

  it('calcula o troco quando o valor recebido cobre o total', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 7 })
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 2 }]) // total 14
      const sale = await c.one<{ troco: string; total: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, 20)`,
        [items],
      )
      expect(Number(sale!.total)).toBe(14)
      expect(Number(sale!.troco)).toBe(6)
    })
  })

  it('recusa quando o valor recebido é menor que o total', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10 })
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const items = JSON.stringify([{ product_id: prod, quantidade: 2 }]) // total 20
      await c.expectError(
        () => c.q(`select public.registrar_venda($1::jsonb, 'dinheiro', 0, null, 5)`, [items]),
        /recebido menor/i,
      )
    })
  })

  it('recusa lista de itens vazia', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      await c.expectError(
        () => c.q(`select public.registrar_venda('[]'::jsonb, 'dinheiro', 0, null, null)`),
        /não tem itens/i,
      )
    })
  })
})
