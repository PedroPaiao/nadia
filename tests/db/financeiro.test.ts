import { describe, it, expect } from 'vitest'
import { tx } from '../helpers/db'

// Regras de negócio do domínio FINANCEIRO (contas, despesas, pagar_despesa,
// financeiro_periodo). Cada teste roda numa transação revertida no fim — nada é
// gravado de verdade.

describe('RLS admin-only de contas e despesas', () => {
  // A policy é "for all" com USING/WITH CHECK = is_admin(). Para um funcionário
  // isso significa: SELECT/UPDATE/DELETE não enxergam linha nenhuma (o USING as
  // filtra, então UPDATE/DELETE afetam 0 linhas — não dá erro) e INSERT bate na
  // WITH CHECK (erro de row-level security). Cobrimos os 4 verbos.
  it('funcionário é barrado em TODOS os verbos de contas (SELECT/INSERT/UPDATE/DELETE)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')

      // Prepara uma conta como superusuário (bypassa RLS).
      await c.asSuperuser()
      const contaId = await c.val<string>(
        `insert into public.contas (nome, saldo) values ('Cofre', 100) returning id`,
      )

      await c.asUser(func)

      // SELECT: RLS filtra tudo -> 0 linhas.
      const nSelect = await c.val<string>(`select count(*) from public.contas`)
      expect(Number(nSelect)).toBe(0)

      // UPDATE: a linha semeada é invisível (USING), então afeta 0 linhas — o saldo
      // real permanece 100 (checado logo abaixo).
      const upd = await c.q(`update public.contas set saldo = 0 where id = $1`, [contaId])
      expect(upd.rowCount).toBe(0)

      // DELETE: idem — 0 linhas afetadas.
      const del = await c.q(`delete from public.contas where id = $1`, [contaId])
      expect(del.rowCount).toBe(0)

      // A conta segue intacta (saldo 100), provando que UPDATE/DELETE não vazaram.
      // Checado como superusuário; volta a func antes do INSERT que aborta a tx.
      await c.asSuperuser()
      const saldo = await c.val<string>(`select saldo from public.contas where id = $1`, [contaId])
      expect(Number(saldo)).toBe(100)

      // INSERT: barrado pela WITH CHECK (is_admin()). Fica por ÚLTIMO porque o erro
      // de RLS aborta a transação — qualquer comando após ele falharia.
      await c.asUser(func)
      await c.expectError(
        () => c.q(`insert into public.contas (nome, saldo) values ('Hacker', 999)`),
        /row-level security/i,
      )
    })
  })

  it('funcionário é barrado em TODOS os verbos de despesas (SELECT/INSERT/UPDATE/DELETE)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')

      await c.asSuperuser()
      const despId = await c.val<string>(
        `insert into public.despesas (descricao, valor, status) values ('Aluguel', 800, 'pendente') returning id`,
      )

      await c.asUser(func)

      // SELECT: 0 linhas.
      const nSelect = await c.val<string>(`select count(*) from public.despesas`)
      expect(Number(nSelect)).toBe(0)

      // UPDATE: linha invisível -> 0 linhas.
      const upd = await c.q(`update public.despesas set status = 'pago' where id = $1`, [despId])
      expect(upd.rowCount).toBe(0)

      // DELETE: idem.
      const del = await c.q(`delete from public.despesas where id = $1`, [despId])
      expect(del.rowCount).toBe(0)

      // A despesa segue pendente, provando que UPDATE/DELETE não vazaram.
      await c.asSuperuser()
      const status = await c.val<string>(`select status from public.despesas where id = $1`, [despId])
      expect(status).toBe('pendente')

      // INSERT: barrado pela WITH CHECK. Fica por ÚLTIMO porque o erro de RLS aborta
      // a transação — qualquer comando após ele falharia.
      await c.asUser(func)
      await c.expectError(
        () => c.q(`insert into public.despesas (descricao, valor) values ('Fraude', 1)`),
        /row-level security/i,
      )
    })
  })

  it('ADMIN enxerga e insere em contas e despesas', async () => {
    await tx(async (c) => {
      const admin = await c.userId('admin')

      // Deixa o banco de teste sem contas/despesas herdadas: conta apenas o que
      // este teste insere. Rollback ao fim desfaz tudo.
      await c.asSuperuser()
      await c.q(`delete from public.despesas`)
      await c.q(`delete from public.contas`)

      await c.asUser(admin)
      // Admin consegue inserir conta e despesa.
      const contaId = await c.val<string>(
        `insert into public.contas (nome, saldo) values ('Caixa Loja', 300) returning id`,
      )
      const despId = await c.val<string>(
        `insert into public.despesas (descricao, valor, status) values ('Luz', 250, 'pendente') returning id`,
      )
      expect(contaId).toBeTruthy()
      expect(despId).toBeTruthy()

      // Admin consegue enxergar os dados que inseriu.
      const conta = await c.one<{ nome: string; saldo: string }>(
        `select nome, saldo from public.contas where id = $1`,
        [contaId],
      )
      expect(conta!.nome).toBe('Caixa Loja')
      expect(Number(conta!.saldo)).toBe(300)

      const desp = await c.one<{ descricao: string; valor: string }>(
        `select descricao, valor from public.despesas where id = $1`,
        [despId],
      )
      expect(desp!.descricao).toBe('Luz')
      expect(Number(desp!.valor)).toBe(250)
    })
  })
})

describe('pagar_despesa', () => {
  it('marca a despesa como paga e ABATE o saldo da conta pelo valor', async () => {
    await tx(async (c) => {
      const admin = await c.userId('admin')

      await c.asSuperuser()
      const contaId = await c.val<string>(
        `insert into public.contas (nome, saldo) values ('Banco', 500) returning id`,
      )
      const despId = await c.val<string>(
        `insert into public.despesas (descricao, valor, status) values ('Fornecedor', 120, 'pendente') returning id`,
      )

      // Admin paga a despesa apontando para a conta 'Banco'.
      await c.asUser(admin)
      const paga = await c.one<{ status: string; forma_pagamento: string; conta_id: string; valor: string }>(
        `select * from public.pagar_despesa($1, 'pix'::order_payment_method, $2, null)`,
        [despId, contaId],
      )

      // A RPC devolve a despesa já paga.
      expect(paga!.status).toBe('pago')
      expect(paga!.forma_pagamento).toBe('pix')
      expect(paga!.conta_id).toBe(contaId)

      // A despesa persistida está paga e com data_pagamento preenchida.
      const desp = await c.one<{ status: string; data_pagamento: string | null }>(
        `select status, data_pagamento from public.despesas where id = $1`,
        [despId],
      )
      expect(desp!.status).toBe('pago')
      expect(desp!.data_pagamento).not.toBeNull()

      // O saldo da conta diminuiu exatamente pelo valor da despesa: 500 - 120 = 380.
      const saldo = await c.val<string>(`select saldo from public.contas where id = $1`, [contaId])
      expect(Number(saldo)).toBe(380)
    })
  })

  it('paga a despesa SEM conta (p_conta_id NULL) e não mexe em saldo de conta nenhuma', async () => {
    await tx(async (c) => {
      const admin = await c.userId('admin')

      // Duas contas semeadas: nenhuma deve ter o saldo alterado por um pagamento
      // sem conta. Isola o ambiente pra que a checagem de "nenhuma conta mexeu"
      // (sum dos saldos) seja determinística.
      await c.asSuperuser()
      await c.q(`delete from public.contas`)
      const contaA = await c.val<string>(
        `insert into public.contas (nome, saldo) values ('A', 500) returning id`,
      )
      const contaB = await c.val<string>(
        `insert into public.contas (nome, saldo) values ('B', 700) returning id`,
      )
      const despId = await c.val<string>(
        `insert into public.despesas (descricao, valor, status) values ('Avulsa', 120, 'pendente') returning id`,
      )

      // Admin paga a despesa SEM apontar conta (p_conta_id = NULL).
      await c.asUser(admin)
      const paga = await c.one<{
        status: string
        forma_pagamento: string
        conta_id: string | null
        data_pagamento: string | null
      }>(`select * from public.pagar_despesa($1, 'dinheiro'::order_payment_method, null, null)`, [
        despId,
      ])

      // A RPC devolve a despesa paga, com forma setada e conta_id NULL.
      expect(paga!.status).toBe('pago')
      expect(paga!.forma_pagamento).toBe('dinheiro')
      expect(paga!.conta_id).toBeNull()
      expect(paga!.data_pagamento).not.toBeNull()

      // Persistida: paga, com data_pagamento e conta_id NULL.
      const desp = await c.one<{
        status: string
        data_pagamento: string | null
        conta_id: string | null
      }>(`select status, data_pagamento, conta_id from public.despesas where id = $1`, [despId])
      expect(desp!.status).toBe('pago')
      expect(desp!.data_pagamento).not.toBeNull()
      expect(desp!.conta_id).toBeNull()

      // Nenhum saldo mudou: A segue 500, B segue 700 (soma 1200).
      await c.asSuperuser()
      const saldoA = await c.val<string>(`select saldo from public.contas where id = $1`, [contaA])
      const saldoB = await c.val<string>(`select saldo from public.contas where id = $1`, [contaB])
      const soma = await c.val<string>(`select coalesce(sum(saldo), 0) from public.contas`)
      expect(Number(saldoA)).toBe(500)
      expect(Number(saldoB)).toBe(700)
      expect(Number(soma)).toBe(1200)
    })
  })

  it('recusa pagar uma despesa que já está paga', async () => {
    await tx(async (c) => {
      const admin = await c.userId('admin')

      await c.asSuperuser()
      const contaId = await c.val<string>(
        `insert into public.contas (nome, saldo) values ('Banco', 500) returning id`,
      )
      const despId = await c.val<string>(
        `insert into public.despesas (descricao, valor, status) values ('Gás', 90, 'pago') returning id`,
      )

      await c.asUser(admin)
      await c.expectError(
        () =>
          c.q(`select public.pagar_despesa($1, 'dinheiro'::order_payment_method, $2, null)`, [
            despId,
            contaId,
          ]),
        /já está paga/i,
      )
    })
  })

  it('recusa despesa inexistente', async () => {
    await tx(async (c) => {
      const admin = await c.userId('admin')
      await c.asUser(admin)
      await c.expectError(
        () =>
          c.q(
            `select public.pagar_despesa('00000000-0000-0000-0000-000000000000'::uuid, 'dinheiro'::order_payment_method, null, null)`,
          ),
        /não encontrada/i,
      )
    })
  })

  it('recusa quando quem chama NÃO é admin', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')

      await c.asSuperuser()
      const despId = await c.val<string>(
        `insert into public.despesas (descricao, valor, status) values ('Internet', 100, 'pendente') returning id`,
      )

      await c.asUser(func)
      await c.expectError(
        () =>
          c.q(`select public.pagar_despesa($1, 'dinheiro'::order_payment_method, null, null)`, [despId]),
        /administradora/i,
      )
    })
  })
})

describe('financeiro_periodo', () => {
  it('soma entradas (vendas + encomendas pagas) e saídas (despesas pagas) no período', async () => {
    await tx(async (c) => {
      const admin = await c.userId('admin')
      const func = await c.userId('funcionario')

      const inicio = '2030-01-01T00:00:00Z'
      const fim = '2030-02-01T00:00:00Z'
      const dentro = '2030-01-15T12:00:00Z'
      const fora = '2030-03-10T12:00:00Z'

      // Seed determinístico como superusuário.
      await c.asSuperuser()

      // Venda concluída DENTRO do período -> conta como entrada (total 100).
      await c.q(
        `insert into public.sales (funcionario_id, subtotal, desconto, total, forma_pagamento, status, created_at)
         values ($1, 100, 0, 100, 'dinheiro'::payment_method, 'concluida'::sale_status, $2)`,
        [func, dentro],
      )
      // Venda concluída FORA do período -> NÃO conta.
      await c.q(
        `insert into public.sales (funcionario_id, subtotal, desconto, total, forma_pagamento, status, created_at)
         values ($1, 999, 0, 999, 'dinheiro'::payment_method, 'concluida'::sale_status, $2)`,
        [func, fora],
      )
      // Venda cancelada DENTRO do período -> NÃO conta (status != concluida).
      await c.q(
        `insert into public.sales (funcionario_id, subtotal, desconto, total, forma_pagamento, status, created_at)
         values ($1, 777, 0, 777, 'dinheiro'::payment_method, 'cancelada'::sale_status, $2)`,
        [func, dentro],
      )

      // Encomenda PAGA dentro do período -> conta como entrada de encomendas (total 50).
      await c.q(
        `insert into public.orders (cliente_nome, subtotal, total, status, data_pagamento)
         values ('Cliente A', 50, 50, 'pago'::order_status, $1)`,
        [dentro],
      )
      // Encomenda paga FORA do período -> NÃO conta.
      await c.q(
        `insert into public.orders (cliente_nome, subtotal, total, status, data_pagamento)
         values ('Cliente B', 500, 500, 'pago'::order_status, $1)`,
        [fora],
      )
      // Encomenda pendente DENTRO do período -> NÃO conta (status != pago).
      await c.q(
        `insert into public.orders (cliente_nome, subtotal, total, status, data_pagamento)
         values ('Cliente C', 300, 300, 'pendente'::order_status, null)`,
      )

      // Despesa PAGA dentro do período -> conta como saída (valor 30).
      await c.q(
        `insert into public.despesas (descricao, valor, status, data_pagamento)
         values ('Farinha', 30, 'pago'::expense_status, $1)`,
        [dentro],
      )
      // Despesa paga FORA do período -> NÃO conta.
      await c.q(
        `insert into public.despesas (descricao, valor, status, data_pagamento)
         values ('Óleo', 200, 'pago'::expense_status, $1)`,
        [fora],
      )
      // Despesa pendente DENTRO do período -> NÃO conta (status != pago).
      await c.q(
        `insert into public.despesas (descricao, valor, status, data_pagamento)
         values ('Sal', 400, 'pendente'::expense_status, null)`,
      )

      // Admin consulta o período.
      await c.asUser(admin)
      const r = await c.one<{
        entradas_vendas: string
        entradas_encomendas: string
        saidas_despesas: string
      }>(`select * from public.financeiro_periodo($1::timestamptz, $2::timestamptz)`, [inicio, fim])

      expect(Number(r!.entradas_vendas)).toBe(100)
      expect(Number(r!.entradas_encomendas)).toBe(50)
      expect(Number(r!.saidas_despesas)).toBe(30)
    })
  })

  it('inclui o instante EXATO de p_inicio e exclui o de p_fim (>= inicio, < fim)', async () => {
    await tx(async (c) => {
      const admin = await c.userId('admin')
      const func = await c.userId('funcionario')

      // Janela dedicada e vazia de qualquer lançamento herdado.
      const inicio = '2031-06-01T00:00:00Z'
      const fim = '2031-07-01T00:00:00Z'

      await c.asSuperuser()

      // Venda EXATAMENTE em p_inicio -> DEVE contar (created_at >= p_inicio).
      await c.q(
        `insert into public.sales (funcionario_id, subtotal, desconto, total, forma_pagamento, status, created_at)
         values ($1, 40, 0, 40, 'dinheiro'::payment_method, 'concluida'::sale_status, $2)`,
        [func, inicio],
      )
      // Venda EXATAMENTE em p_fim -> NÃO deve contar (created_at < p_fim é falso).
      await c.q(
        `insert into public.sales (funcionario_id, subtotal, desconto, total, forma_pagamento, status, created_at)
         values ($1, 999, 0, 999, 'dinheiro'::payment_method, 'concluida'::sale_status, $2)`,
        [func, fim],
      )

      // Encomenda paga EXATAMENTE em p_inicio -> conta; em p_fim -> não conta.
      await c.q(
        `insert into public.orders (cliente_nome, subtotal, total, status, data_pagamento)
         values ('Borda Início', 25, 25, 'pago'::order_status, $1)`,
        [inicio],
      )
      await c.q(
        `insert into public.orders (cliente_nome, subtotal, total, status, data_pagamento)
         values ('Borda Fim', 888, 888, 'pago'::order_status, $1)`,
        [fim],
      )

      // Despesa paga EXATAMENTE em p_inicio -> conta; em p_fim -> não conta.
      await c.q(
        `insert into public.despesas (descricao, valor, status, data_pagamento)
         values ('Borda Início', 15, 'pago'::expense_status, $1)`,
        [inicio],
      )
      await c.q(
        `insert into public.despesas (descricao, valor, status, data_pagamento)
         values ('Borda Fim', 777, 'pago'::expense_status, $1)`,
        [fim],
      )

      await c.asUser(admin)
      const r = await c.one<{
        entradas_vendas: string
        entradas_encomendas: string
        saidas_despesas: string
      }>(`select * from public.financeiro_periodo($1::timestamptz, $2::timestamptz)`, [inicio, fim])

      // Só os lançamentos da borda de p_inicio entram; os de p_fim ficam de fora.
      expect(Number(r!.entradas_vendas)).toBe(40)
      expect(Number(r!.entradas_encomendas)).toBe(25)
      expect(Number(r!.saidas_despesas)).toBe(15)
    })
  })

  it('devolve zeros quando não há movimento no período (coalesce)', async () => {
    await tx(async (c) => {
      const admin = await c.userId('admin')
      await c.asUser(admin)

      // Período no futuro distante, garantidamente sem lançamentos.
      const r = await c.one<{
        entradas_vendas: string
        entradas_encomendas: string
        saidas_despesas: string
      }>(`select * from public.financeiro_periodo($1::timestamptz, $2::timestamptz)`, [
        '2099-01-01T00:00:00Z',
        '2099-02-01T00:00:00Z',
      ])

      expect(Number(r!.entradas_vendas)).toBe(0)
      expect(Number(r!.entradas_encomendas)).toBe(0)
      expect(Number(r!.saidas_despesas)).toBe(0)
    })
  })

  it('recusa quando quem chama NÃO é admin', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      await c.asUser(func)
      await c.expectError(
        () =>
          c.q(`select * from public.financeiro_periodo($1::timestamptz, $2::timestamptz)`, [
            '2030-01-01T00:00:00Z',
            '2030-02-01T00:00:00Z',
          ]),
        /administradora/i,
      )
    })
  })
})
