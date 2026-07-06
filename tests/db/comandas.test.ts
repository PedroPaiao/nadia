import { describe, it, expect } from 'vitest'
import { tx, criarProduto } from '../helpers/db'

// Regras de negócio das COMANDAS (mesas) do PDV.
// abrir_comanda / adicionar_item_comanda / remover_item_comanda / cancelar_comanda / fechar_comanda.
// Cada teste roda numa transação revertida no fim — nada é gravado de verdade.
//
// Convenção de estoque (via trigger apply_stock_movement: estoque_atual + quantidade):
//   - adicionar_item_comanda insere movimento NEGATIVO (baixa na hora que o salgado sai da vitrine).
//   - remover_item_comanda / cancelar_comanda inserem movimento POSITIVO (estorno / devolução).
//   - fechar_comanda NÃO mexe no estoque (a baixa já aconteceu na adição).

describe('abrir_comanda', () => {
  it('cria a comanda ABERTA no nome do funcionário autenticado', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)
      const com = await c.one<{ id: string; nome: string; status: string; funcionario_id: string }>(
        `select * from public.abrir_comanda('Mesa 1')`,
      )
      expect(com!.nome).toBe('Mesa 1')
      expect(com!.status).toBe('aberta')
      expect(com!.funcionario_id).toBe(func)
    })
  })

  it('faz trim no nome e recusa nome vazio', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)
      const com = await c.one<{ nome: string }>(`select * from public.abrir_comanda('  Mesa 2  ')`)
      expect(com!.nome).toBe('Mesa 2')
      await c.expectError(() => c.q(`select public.abrir_comanda('   ')`), /nome/i)
    })
  })
})

describe('adicionar_item_comanda', () => {
  it('baixa o estoque NA HORA e cria o movimento negativo (venda)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 3')`)
      const item = await c.one<{ id: string; subtotal: string; quantidade: string }>(
        `select * from public.adicionar_item_comanda($1, $2, 4)`,
        [com!.id, prod],
      )
      // subtotal = 4 * 10
      expect(Number(item!.quantidade)).toBe(4)
      expect(Number(item!.subtotal)).toBe(40)

      // estoque caiu de 100 para 96
      const estoque = await c.val<string>(`select estoque_atual from public.products where id = $1`, [prod])
      expect(Number(estoque)).toBe(96)

      // movimento de estoque negativo, tipo venda, referenciando a comanda.
      // Busca pelo product_id (NÃO pelo referencia_id) para que a asserção de
      // referencia_id == com.id seja de verdade, e não tautológica.
      const mov = await c.one<{ quantidade: string; tipo: string; referencia_id: string }>(
        `select quantidade, tipo, referencia_id from public.stock_movements where product_id = $1`,
        [prod],
      )
      expect(Number(mov!.quantidade)).toBe(-4)
      expect(mov!.tipo).toBe('venda')
      expect(mov!.referencia_id).toBe(com!.id)
    })
  })

  it('NÃO cria movimento de estoque para produto que não controla estoque', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { controla_estoque: false, estoque_atual: 0 })

      await c.asUser(func)
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 4')`)
      await c.q(`select public.adicionar_item_comanda($1, $2, 2)`, [com!.id, prod])

      const n = await c.val<string>(
        `select count(*) from public.stock_movements where referencia_id = $1`,
        [com!.id],
      )
      expect(Number(n)).toBe(0)
    })
  })

  it('recusa quantidade inválida (zero ou negativa)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })
      await c.asUser(func)
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 5')`)
      await c.expectError(
        () => c.q(`select public.adicionar_item_comanda($1, $2, 0)`, [com!.id, prod]),
        /quantidade inválida/i,
      )
    })
  })

  it('recusa produto inativo', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { ativo: false })
      await c.asUser(func)
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 6')`)
      await c.expectError(
        () => c.q(`select public.adicionar_item_comanda($1, $2, 1)`, [com!.id, prod]),
        /inativo/i,
      )
    })
  })

  it('recusa adicionar item em comanda não aberta', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })
      await c.asUser(func)
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 7')`)
      // cancela a comanda -> deixa de estar aberta
      await c.q(`select public.cancelar_comanda($1)`, [com!.id])
      await c.expectError(
        () => c.q(`select public.adicionar_item_comanda($1, $2, 1)`, [com!.id, prod]),
        /não está aberta/i,
      )
    })
  })
})

describe('remover_item_comanda', () => {
  it('ESTORNA o estoque ao remover o item (volta ao valor anterior)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 8')`)
      const item = await c.one<{ id: string }>(
        `select * from public.adicionar_item_comanda($1, $2, 3)`,
        [com!.id, prod],
      )
      // após adicionar 3, estoque = 97
      let estoque = await c.val<string>(`select estoque_atual from public.products where id = $1`, [prod])
      expect(Number(estoque)).toBe(97)

      await c.q(`select public.remover_item_comanda($1)`, [item!.id])

      // estorno: estoque volta a 100
      estoque = await c.val<string>(`select estoque_atual from public.products where id = $1`, [prod])
      expect(Number(estoque)).toBe(100)

      // item foi deletado da comanda
      const n = await c.val<string>(
        `select count(*) from public.comanda_items where comanda_id = $1`,
        [com!.id],
      )
      expect(Number(n)).toBe(0)

      // movimento de estorno positivo, tipo cancelamento
      const mov = await c.one<{ quantidade: string; tipo: string }>(
        `select quantidade, tipo from public.stock_movements where referencia_id = $1 and tipo = 'cancelamento'`,
        [com!.id],
      )
      expect(Number(mov!.quantidade)).toBe(3)
      expect(mov!.tipo).toBe('cancelamento')
    })
  })
})

describe('cancelar_comanda', () => {
  it('ESTORNA o estoque de todos os itens e marca a comanda como cancelada', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 9')`)
      await c.q(`select public.adicionar_item_comanda($1, $2, 5)`, [com!.id, prod])

      // após adicionar 5, estoque = 95
      let estoque = await c.val<string>(`select estoque_atual from public.products where id = $1`, [prod])
      expect(Number(estoque)).toBe(95)

      await c.q(`select public.cancelar_comanda($1)`, [com!.id])

      // estorno total: volta a 100
      estoque = await c.val<string>(`select estoque_atual from public.products where id = $1`, [prod])
      expect(Number(estoque)).toBe(100)

      // status vira cancelada
      const status = await c.val<string>(`select status from public.comandas where id = $1`, [com!.id])
      expect(status).toBe('cancelada')
    })
  })

  it('recusa cancelar uma comanda que não está aberta', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 10')`)
      await c.q(`select public.cancelar_comanda($1)`, [com!.id])
      // segunda tentativa: já cancelada
      await c.expectError(
        () => c.q(`select public.cancelar_comanda($1)`, [com!.id]),
        /não está aberta/i,
      )
    })
  })
})

describe('fechar_comanda', () => {
  it('exige um caixa ABERTO — sem caixa, o fechamento é recusado', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })
      await c.asUser(func)
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 11')`)
      await c.q(`select public.adicionar_item_comanda($1, $2, 1)`, [com!.id, prod])
      // sem abrir caixa:
      await c.expectError(
        () => c.q(`select public.fechar_comanda($1, 'dinheiro', 0, null)`, [com!.id]),
        /caixa aberto/i,
      )
    })
  })

  it('copia os itens para uma venda concluída e NÃO baixa o estoque de novo', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      const caixa = await c.one<{ id: string }>(
        `select * from public.abrir_caixa(p_valor_abertura => 0)`,
      )
      const caixaId = caixa!.id
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 12')`)
      await c.q(`select public.adicionar_item_comanda($1, $2, 4)`, [com!.id, prod])

      // baixa já aconteceu na adição: 100 -> 96
      const estoqueAntes = await c.val<string>(
        `select estoque_atual from public.products where id = $1`,
        [prod],
      )
      expect(Number(estoqueAntes)).toBe(96)

      const sale = await c.one<{
        id: string
        subtotal: string
        total: string
        status: string
        cash_session_id: string
      }>(`select * from public.fechar_comanda($1, 'dinheiro', 0, null)`, [com!.id])
      // vira uma sale concluida com o total dos itens (4 * 10)
      expect(Number(sale!.subtotal)).toBe(40)
      expect(Number(sale!.total)).toBe(40)
      expect(sale!.status).toBe('concluida')

      // a venda entra NO caixa que estava aberto
      expect(sale!.cash_session_id).toBe(caixaId)

      // estoque NÃO muda ao fechar (segue 96)
      const estoqueDepois = await c.val<string>(
        `select estoque_atual from public.products where id = $1`,
        [prod],
      )
      expect(Number(estoqueDepois)).toBe(96)

      // os itens foram copiados para sale_items
      const itens = await c.one<{ n: string; qtd: string }>(
        `select count(*)::text as n, coalesce(sum(quantidade),0)::text as qtd from public.sale_items where sale_id = $1`,
        [sale!.id],
      )
      expect(Number(itens!.n)).toBe(1)
      expect(Number(itens!.qtd)).toBe(4)

      // fechar NÃO gera novo movimento de estoque (só existe o -4 da adição)
      const movs = await c.val<string>(
        `select count(*) from public.stock_movements where referencia_id = $1`,
        [com!.id],
      )
      expect(Number(movs)).toBe(1)

      // a comanda vira fechada, aponta para a venda e registra o caixa aberto
      const comFechada = await c.one<{ status: string; sale_id: string; cash_session_id: string }>(
        `select status, sale_id, cash_session_id from public.comandas where id = $1`,
        [com!.id],
      )
      expect(comFechada!.status).toBe('fechada')
      expect(comFechada!.sale_id).toBe(sale!.id)
      expect(comFechada!.cash_session_id).toBe(caixaId)
    })
  })

  it('calcula o troco quando o valor recebido cobre o total', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 7, estoque_atual: 100 })

      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 13')`)
      await c.q(`select public.adicionar_item_comanda($1, $2, 2)`, [com!.id, prod]) // total 14

      const sale = await c.one<{ total: string; troco: string }>(
        `select * from public.fechar_comanda($1, 'dinheiro', 0, 20)`,
        [com!.id],
      )
      expect(Number(sale!.total)).toBe(14)
      expect(Number(sale!.troco)).toBe(6)
    })
  })

  it('recusa quando o valor recebido é menor que o total (dinheiro)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 13b')`)
      await c.q(`select public.adicionar_item_comanda($1, $2, 2)`, [com!.id, prod]) // total 20
      // recebe 5, bem abaixo do total 20 -> deve recusar (lógica própria do fechar_comanda)
      await c.expectError(
        () => c.q(`select public.fechar_comanda($1, 'dinheiro', 0, 5)`, [com!.id]),
        /menor que o total/i,
      )
    })
  })

  it('recusa desconto maior que o subtotal', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 14')`)
      await c.q(`select public.adicionar_item_comanda($1, $2, 1)`, [com!.id, prod]) // subtotal 10
      await c.expectError(
        () => c.q(`select public.fechar_comanda($1, 'dinheiro', 999, null)`, [com!.id]),
        /desconto maior/i,
      )
    })
  })

  it('recusa fechar comanda vazia (sem itens)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 15')`)
      await c.expectError(
        () => c.q(`select public.fechar_comanda($1, 'dinheiro', 0, null)`, [com!.id]),
        /vazia/i,
      )
    })
  })

  it('recusa fechar DUAS vezes a mesma comanda (proteção de dupla-venda)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })
      const com = await c.one<{ id: string }>(`select * from public.abrir_comanda('Mesa 16')`)
      await c.q(`select public.adicionar_item_comanda($1, $2, 1)`, [com!.id, prod])

      // primeiro fechamento OK
      const sale = await c.one<{ id: string }>(
        `select * from public.fechar_comanda($1, 'dinheiro', 0, null)`,
        [com!.id],
      )

      // segundo fechamento deve falhar (comanda já não está aberta).
      // Envolve num SAVEPOINT: a exceção aborta a subtransação, mas o rollback ao
      // savepoint devolve a transação a um estado utilizável para as asserções abaixo.
      await c.q(`savepoint sp_dupla`)
      await c.expectError(
        () => c.q(`select public.fechar_comanda($1, 'dinheiro', 0, null)`, [com!.id]),
        /não está aberta/i,
      )
      await c.q(`rollback to savepoint sp_dupla`)

      // prova que NENHUMA venda duplicada foi criada: a comanda tem exatamente 1 sale,
      // esse sale tem exatamente 1 item, e a comanda tem exatamente 1 movimento de estoque.
      const nSales = await c.val<string>(
        `select count(*) from public.sales s
           join public.comandas cm on cm.sale_id = s.id
          where cm.id = $1`,
        [com!.id],
      )
      expect(Number(nSales)).toBe(1)

      const nItems = await c.val<string>(
        `select count(*) from public.sale_items where sale_id = $1`,
        [sale!.id],
      )
      expect(Number(nItems)).toBe(1)

      const nMovs = await c.val<string>(
        `select count(*) from public.stock_movements where referencia_id = $1`,
        [com!.id],
      )
      expect(Number(nMovs)).toBe(1)
    })
  })
})
