import { describe, it, expect } from 'vitest'
import { tx, criarProduto } from '../helpers/db'
import type { Ctx } from '../helpers/db'

// Regras de negócio mais importantes do CAIXA
// (abrir_caixa / fechar_caixa / registrar_movimento_caixa / caixa_resumo + trigger append-only).
// Cada teste roda numa transação revertida no fim — nada é gravado de verdade.

// Todos estes testes partem do invariante "não há caixa aberto no início". Como o
// banco de dev pode ficar com uma sessão aberta de uso manual do app (a seed NÃO
// cria nenhuma), removemos qualquer sessão 'aberto' DENTRO da transação de teste.
// Isso vive só na transação (revertida no rollback), nunca toca o estado commitado
// do banco e garante um ponto de partida limpo e determinístico.
//
// O DELETE dispara o trigger guard_cash_sessions, cujo ramo de DELETE exige
// is_admin(). Então setamos os claims da ADMIN (mantendo papel de superusuário p/
// ignorar RLS) só para a limpeza, e voltamos ao superusuário puro em seguida.
async function baselineSemCaixaAberto(c: Ctx): Promise<void> {
  await c.asSuperuser()
  const admin = await c.userId('admin')
  await c.q(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: admin, role: 'authenticated' }),
  ])
  await c.q(`delete from public.cash_movements where cash_session_id in
              (select id from public.cash_sessions where status = 'aberto')`)
  await c.q(`delete from public.cash_sessions where status = 'aberto'`)
  await c.asSuperuser()
}

describe('abrir_caixa', () => {
  it('só permite UM caixa aberto por vez — abrir um segundo falha', async () => {
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      await c.asUser(func)

      // Primeiro caixa abre normalmente.
      await c.rpc('abrir_caixa', { p_valor_abertura: 100 })

      // Segundo caixa, com um já aberto, deve ser recusado. O erro vem da VALIDAÇÃO
      // da própria RPC (ela checa `exists(... status='aberto')` e levanta a exceção
      // ANTES de tentar o insert), e não da violação do índice único parcial.
      await c.expectError(
        () => c.rpc('abrir_caixa', { p_valor_abertura: 50 }),
        /já existe um caixa aberto/i,
      )
    })
  })

  it('o índice único parcial (cash_sessions_um_aberto_idx) barra 2 sessões abertas mesmo por INSERT direto', async () => {
    // Prova que, além da validação da RPC, existe uma garantia no NÍVEL DO BANCO:
    // dois INSERT diretos de cash_session status='aberto' (como superusuário, sem
    // passar pela RPC) violam o índice único parcial. Isso é a rede de segurança
    // caso alguém insira contornando a RPC.
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      await c.asSuperuser()

      // O PRIMEIRO insert precisa ter sucesso (só assim a violação vem do SEGUNDO,
      // e não de uma sessão aberta preexistente) — por isso o baseline acima.
      await c.q(
        `insert into public.cash_sessions (funcionario_id, valor_abertura, status)
         values ($1, 10, 'aberto')`,
        [func],
      )
      await c.expectError(
        () =>
          c.q(
            `insert into public.cash_sessions (funcionario_id, valor_abertura, status)
             values ($1, 20, 'aberto')`,
            [func],
          ),
        /cash_sessions_um_aberto_idx|duplicate key|unique/i,
      )
    })
  })

  it('grava o valor de abertura e status aberto', async () => {
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      await c.asUser(func)

      const sessao = await c.one<{ status: string; valor_abertura: string }>(
        `select * from public.abrir_caixa(150, null)`,
      )
      expect(sessao!.status).toBe('aberto')
      expect(Number(sessao!.valor_abertura)).toBe(150)
    })
  })
})

describe('fechar_caixa', () => {
  it('calcula o esperado internamente (abertura + vendas dinheiro + suprimentos - sangrias) e a diferença', async () => {
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      await c.asUser(func)
      // abertura = 100
      await c.rpc('abrir_caixa', { p_valor_abertura: 100 })

      // 1 venda em dinheiro: 3 x 10 = 30
      const items = JSON.stringify([{ product_id: prod, quantidade: 3 }])
      const venda = await c.one<{ total: string }>(
        `select * from public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`,
        [items],
      )
      expect(Number(venda!.total)).toBe(30)

      // 1 suprimento = 50 e 1 sangria = 20
      await c.rpc('registrar_movimento_caixa', {
        p_tipo: 'suprimento',
        p_valor: 50,
        p_motivo: 'troco',
      })
      await c.rpc('registrar_movimento_caixa', {
        p_tipo: 'sangria',
        p_valor: 20,
        p_motivo: 'retirada',
      })

      // Fecha informando 170.
      // Esperado (calculado) = 100 + 30 + 50 - 20 = 160.
      // fechar_caixa grava o calculado (do servidor) e o informado (do cliente);
      // NÃO retorna coluna de diferença. A diferença real (informado - esperado) é
      // responsabilidade da RPC caixa_resumo e está coberta no teste dela abaixo.
      const fechada = await c.one<{
        status: string
        valor_fechamento_calculado: string
        valor_fechamento_informado: string
      }>(`select * from public.fechar_caixa(170, null)`)

      expect(fechada!.status).toBe('fechado')
      expect(Number(fechada!.valor_fechamento_calculado)).toBe(160)
      expect(Number(fechada!.valor_fechamento_informado)).toBe(170)
    })
  })

  it('um FUNCIONÁRIO (func) consegue fechar o caixa (não depende de caixa_resumo/admin)', async () => {
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 80 })

      const fechada = await c.one<{ status: string; valor_fechamento_calculado: string }>(
        `select * from public.fechar_caixa(80, null)`,
      )
      expect(fechada!.status).toBe('fechado')
      // Sem vendas/movimentos: esperado = só a abertura = 80.
      expect(Number(fechada!.valor_fechamento_calculado)).toBe(80)
    })
  })

  it('recusa fechar quando não há caixa aberto', async () => {
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      await c.asUser(func)
      await c.expectError(
        () => c.rpc('fechar_caixa', { p_valor_informado: 0 }),
        /nenhum caixa aberto/i,
      )
    })
  })
})

describe('registrar_movimento_caixa', () => {
  it('exige um caixa ABERTO — sem caixa, o movimento é recusado', async () => {
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      await c.asUser(func)
      await c.expectError(
        () => c.rpc('registrar_movimento_caixa', { p_tipo: 'suprimento', p_valor: 10 }),
        /nenhum caixa aberto/i,
      )
    })
  })

  it('recusa valor igual a zero', async () => {
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })

      await c.expectError(
        () => c.rpc('registrar_movimento_caixa', { p_tipo: 'sangria', p_valor: 0 }),
        /maior que zero/i,
      )
    })
  })

  it('recusa valor negativo', async () => {
    // Testa separado porque o primeiro erro aborta a transação (rollback ao fim).
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      await c.asUser(func)
      await c.rpc('abrir_caixa', { p_valor_abertura: 0 })

      await c.expectError(
        () => c.rpc('registrar_movimento_caixa', { p_tipo: 'sangria', p_valor: -5 }),
        /maior que zero/i,
      )
    })
  })

  it('registra suprimento e sangria válidos na sessão aberta', async () => {
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      await c.asUser(func)
      const sessaoId = await c.val<string>(`select id from public.abrir_caixa(0, null)`)

      const sup = await c.one<{ tipo: string; valor: string; cash_session_id: string }>(
        `select * from public.registrar_movimento_caixa('suprimento', 40, 'troco')`,
      )
      expect(sup!.tipo).toBe('suprimento')
      expect(Number(sup!.valor)).toBe(40)
      expect(sup!.cash_session_id).toBe(sessaoId)

      const san = await c.one<{ tipo: string; valor: string }>(
        `select * from public.registrar_movimento_caixa('sangria', 15, 'retirada')`,
      )
      expect(san!.tipo).toBe('sangria')
      expect(Number(san!.valor)).toBe(15)
    })
  })
})

describe('caixa_resumo (admin-only)', () => {
  it('lança erro quando chamado por um FUNCIONÁRIO (func)', async () => {
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      await c.asUser(func)
      const sessaoId = await c.val<string>(`select id from public.abrir_caixa(100, null)`)

      await c.expectError(
        () => c.rpc('caixa_resumo', { p_session_id: sessaoId }),
        /administradora/i,
      )
    })
  })

  it('retorna os números certos quando chamado pela ADMIN (dona)', async () => {
    await tx(async (c) => {
      const func = await c.userId('funcionario')
      const admin = await c.userId('admin')
      const prod = await criarProduto(c, { preco_venda: 10, estoque_atual: 100 })

      // Funcionário monta o cenário: abre caixa, faz venda, movimentos e fecha.
      await baselineSemCaixaAberto(c)
      await c.asUser(func)
      const sessaoId = await c.val<string>(`select id from public.abrir_caixa(100, null)`)

      const items = JSON.stringify([{ product_id: prod, quantidade: 3 }]) // 30 em dinheiro
      await c.q(`select public.registrar_venda($1::jsonb, 'dinheiro', 0, null, null)`, [items])
      await c.rpc('registrar_movimento_caixa', { p_tipo: 'suprimento', p_valor: 50 })
      await c.rpc('registrar_movimento_caixa', { p_tipo: 'sangria', p_valor: 20 })
      // informado = 170
      await c.q(`select public.fechar_caixa(170, null)`)

      // Agora a ADMIN consulta o resumo.
      await c.asUser(admin)
      const resumo = await c.one<{
        valor_abertura: string
        vendas_dinheiro: string
        vendas_outras: string
        suprimentos: string
        sangrias: string
        esperado_dinheiro: string
        informado: string
        diferenca: string
      }>(`select * from public.caixa_resumo($1::uuid)`, [sessaoId])

      expect(Number(resumo!.valor_abertura)).toBe(100)
      expect(Number(resumo!.vendas_dinheiro)).toBe(30)
      expect(Number(resumo!.vendas_outras)).toBe(0)
      expect(Number(resumo!.suprimentos)).toBe(50)
      expect(Number(resumo!.sangrias)).toBe(20)
      // esperado = 100 + 30 + 50 - 20 = 160
      expect(Number(resumo!.esperado_dinheiro)).toBe(160)
      expect(Number(resumo!.informado)).toBe(170)
      // diferenca = 170 - 160 = 10
      expect(Number(resumo!.diferenca)).toBe(10)
    })
  })
})

describe('append-only (trigger guard_cash_sessions)', () => {
  // Duas regras DISTINTAS no trigger, que NÃO devem ser confundidas:
  //  - UPDATE: bloqueado por STATUS (`old.status = 'fechado'`), independente do papel.
  //    Ninguém — nem admin — pode alterar uma sessão fechada.
  //  - DELETE: liberado por PAPEL (`is_admin()`), independente do status. Só a admin
  //    apaga; funcionário nunca. (Um bug que trocasse is_admin() por `true` no ramo
  //    DELETE seria pego pelo teste "funcionário NÃO consegue DELETE".)
  //
  // O trigger decide com base em is_admin() (via auth.uid() no JWT) e no status da
  // linha, e não no papel SQL. A RLS de cash_sessions só tem policy de SELECT — sem
  // policy de UPDATE/DELETE, esses comandos casam ZERO linhas para o papel
  // `authenticated`, então o trigger nem dispara nesse caminho. Para exercitar de
  // fato a REGRA do trigger, setamos só os claims do JWT e mantemos o papel de
  // superusuário (RLS ignorada), reproduzindo o contexto de dentro das RPCs
  // SECURITY DEFINER, que é onde o trigger realmente atua.
  async function comClaims(c: Ctx, userId: string) {
    await c.q(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ])
  }

  it('sessão FECHADA é append-only: UPDATE é bloqueado pelo status, independente do papel (funcionário)', async () => {
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      await c.asUser(func)
      const sessaoId = await c.val<string>(`select id from public.abrir_caixa(50, null)`)
      await c.q(`select public.fechar_caixa(50, null)`)

      // Volta ao superusuário (ignora RLS) mas mantém o func como auth.uid().
      await c.asSuperuser()
      await comClaims(c, func)

      await c.expectError(
        () =>
          c.q(`update public.cash_sessions set observacao = 'hack' where id = $1`, [sessaoId]),
        /já fechado não pode ser alterado/i,
      )
    })
  })

  it('sessão FECHADA é append-only: nem a ADMIN consegue UPDATE (bloqueio é por status, não por papel)', async () => {
    // Prova simétrica ao teste acima: o ramo de UPDATE do trigger olha só
    // `old.status = 'fechado'` e NÃO chama is_admin(). Logo a admin também é barrada.
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      const admin = await c.userId('admin')

      await c.asUser(func)
      const sessaoId = await c.val<string>(`select id from public.abrir_caixa(50, null)`)
      await c.q(`select public.fechar_caixa(50, null)`)

      await c.asSuperuser()
      await comClaims(c, admin)

      await c.expectError(
        () =>
          c.q(`update public.cash_sessions set observacao = 'hack' where id = $1`, [sessaoId]),
        /já fechado não pode ser alterado/i,
      )
    })
  })

  it('com um FUNCIONÁRIO logado, DELETE de sessão é bloqueado pelo trigger', async () => {
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      await c.asUser(func)
      const sessaoId = await c.val<string>(`select id from public.abrir_caixa(50, null)`)
      await c.q(`select public.fechar_caixa(50, null)`)

      await c.asSuperuser()
      await comClaims(c, func)

      await c.expectError(
        () => c.q(`delete from public.cash_sessions where id = $1`, [sessaoId]),
        /não podem ser apagadas/i,
      )
    })
  })

  it('com a ADMIN logada, o trigger PERMITE DELETE da sessão de caixa', async () => {
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      const admin = await c.userId('admin')

      await c.asUser(func)
      const sessaoId = await c.val<string>(`select id from public.abrir_caixa(50, null)`)
      await c.q(`select public.fechar_caixa(50, null)`)

      await c.asSuperuser()
      await comClaims(c, admin)
      await c.q(`delete from public.cash_sessions where id = $1`, [sessaoId])

      const n = await c.val<string>(
        `select count(*) from public.cash_sessions where id = $1`,
        [sessaoId],
      )
      expect(Number(n)).toBe(0)
    })
  })

  it('a ADMIN consegue DELETE de uma sessão AINDA ABERTA — o DELETE é liberado por is_admin(), não pelo status', async () => {
    // Ancora a regra "DELETE liberado por papel, não por status": diferentemente do
    // UPDATE (que é barrado quando fechado), o ramo DELETE do trigger só olha
    // is_admin() e nunca o status. Assim a admin apaga até uma sessão ABERTA.
    // Um bug que trocasse is_admin() por `true` no ramo DELETE NÃO seria pego por
    // este teste, mas SIM pelo teste "funcionário NÃO consegue DELETE" acima.
    await tx(async (c) => {
      await baselineSemCaixaAberto(c)
      const func = await c.userId('funcionario')
      const admin = await c.userId('admin')

      await c.asUser(func)
      const sessaoId = await c.val<string>(`select id from public.abrir_caixa(50, null)`)
      // NÃO fecha — a sessão continua com status 'aberto'.

      await c.asSuperuser()
      const statusAntes = await c.val<string>(
        `select status from public.cash_sessions where id = $1`,
        [sessaoId],
      )
      expect(statusAntes).toBe('aberto')

      await comClaims(c, admin)
      await c.q(`delete from public.cash_sessions where id = $1`, [sessaoId])

      const n = await c.val<string>(
        `select count(*) from public.cash_sessions where id = $1`,
        [sessaoId],
      )
      expect(Number(n)).toBe(0)
    })
  })
})
