// Os helpers de data (inicioDoDiaISO/fimDoDiaExclusivoISO/...) NÃO fixam o fuso
// internamente: usam `new Date('yyyy-mm-ddT00:00:00')` (fuso do processo) + `.toISOString()`.
// Com `setDate(+1)` (aritmética de relógio de parede), num dia de virada de DST o delta
// vira 23h/25h — o que quebraria "exatamente 24h" dependendo da TZ do processo
// (ex.: America/Sao_Paulo em 2019-02-16 dá 25h). Fixamos TZ=UTC (sem DST) ANTES de
// qualquer `new Date`, tornando início/fim e o delta de 24h determinísticos.
process.env.TZ = 'UTC'

import { describe, it, expect } from 'vitest'
import {
  normalizeUsuario,
  parseNumber,
  formatDecimalBR,
  formatBRL,
  formatQty,
  inicioDoDiaISO,
  fimDoDiaExclusivoISO,
  hojeData,
  hojeMaisDias,
  primeiroDiaDoMes,
  ultimoDiaDoMes,
} from '@/lib/utils'
import { usuarioParaEmail, USER_EMAIL_DOMAIN } from '@/lib/supabase'

// Testes UNITÁRIOS puros (sem banco). Cada `it` cobre UMA regra; os valores
// esperados são calculados à mão e determinísticos. Os helpers de data são
// testados por INVARIANTES/relações (não por "hoje" hardcoded frágil).

describe('normalizeUsuario', () => {
  it('remove acentos mantendo as letras base', () => {
    expect(normalizeUsuario('João')).toBe('joao')
    expect(normalizeUsuario('José')).toBe('jose')
    expect(normalizeUsuario('ÁÉÍÓÚ')).toBe('aeiou')
  })

  it('reduz a cedilha (ç) a c', () => {
    // Sob NFD o "ç" decompõe em c + cedilha combinante (U+0327), que é removida
    // junto com os demais diacríticos — sobrando só o "c".
    expect(normalizeUsuario('França')).toBe('franca')
    expect(normalizeUsuario('Conceição')).toBe('conceicao')
  })

  it('remove espaços e coloca tudo em caixa baixa', () => {
    expect(normalizeUsuario('João Silva')).toBe('joaosilva')
    expect(normalizeUsuario('  Maria  ')).toBe('maria')
    expect(normalizeUsuario('MARIA')).toBe('maria')
  })

  it('mantém dígitos e os caracteres permitidos . _ -', () => {
    expect(normalizeUsuario('José_1')).toBe('jose_1')
    expect(normalizeUsuario('user.name-2')).toBe('user.name-2')
  })

  it('descarta qualquer caractere fora de [a-z0-9._-]', () => {
    expect(normalizeUsuario('a@b#c!d')).toBe('abcd')
    expect(normalizeUsuario('João@Silva')).toBe('joaosilva')
  })

  it('trata entrada vazia/nula como string vazia', () => {
    expect(normalizeUsuario('')).toBe('')
    // @ts-expect-error testando robustez contra null em runtime
    expect(normalizeUsuario(null)).toBe('')
    // @ts-expect-error testando robustez contra undefined em runtime
    expect(normalizeUsuario(undefined)).toBe('')
  })
})

describe('usuarioParaEmail', () => {
  it('converte o login no e-mail interno sintético', () => {
    expect(usuarioParaEmail('Maria')).toBe('maria@salgaderia.local')
  })

  it('normaliza o login antes de concatenar o domínio', () => {
    expect(usuarioParaEmail('João Silva')).toBe('joaosilva@salgaderia.local')
    expect(usuarioParaEmail('José')).toBe('jose@salgaderia.local')
  })

  it('usa a constante de domínio exportada', () => {
    expect(USER_EMAIL_DOMAIN).toBe('@salgaderia.local')
    expect(usuarioParaEmail('admin')).toBe(`admin${USER_EMAIL_DOMAIN}`)
  })
})

describe('parseNumber', () => {
  it('interpreta a vírgula como separador decimal (pt-BR)', () => {
    expect(parseNumber('12,50')).toBe(12.5)
    expect(parseNumber('0,99')).toBe(0.99)
  })

  it('trata pontos como milhar quando há vírgula decimal', () => {
    expect(parseNumber('1.234,56')).toBe(1234.56)
    expect(parseNumber('1.000.000,00')).toBe(1000000)
  })

  it('ignora símbolos e espaços (ex.: prefixo R$)', () => {
    expect(parseNumber('R$ 1.234,56')).toBe(1234.56)
    expect(parseNumber('  R$ 12,50 ')).toBe(12.5)
  })

  it('com só um ponto, trata o ponto como decimal', () => {
    expect(parseNumber('1.5')).toBe(1.5)
    expect(parseNumber('1.234')).toBe(1.234)
  })

  it('com vários pontos e sem vírgula, trata os pontos como milhar', () => {
    expect(parseNumber('1.234.567')).toBe(1234567)
  })

  it('devolve o próprio número quando a entrada já é numérica e finita', () => {
    expect(parseNumber(5)).toBe(5)
    expect(parseNumber(12.34)).toBe(12.34)
    expect(parseNumber(0)).toBe(0)
  })

  it('interpreta "0" como o valor VÁLIDO zero (não como lixo)', () => {
    // "0" é uma entrada legítima cujo valor é 0 — distinta de '' / 'abc',
    // que também dão 0 porém por serem inválidas.
    expect(parseNumber('0')).toBe(0)
    expect(parseNumber('0,00')).toBe(0)
  })

  it('devolve 0 para entradas vazias, inválidas ou não finitas', () => {
    expect(parseNumber('')).toBe(0)
    expect(parseNumber('abc')).toBe(0)
    expect(parseNumber(Infinity)).toBe(0)
    expect(parseNumber(NaN)).toBe(0)
  })
})

describe('formatDecimalBR', () => {
  it('formata com 2 casas por padrão e vírgula decimal', () => {
    expect(formatDecimalBR(12.5)).toBe('12,50')
    expect(formatDecimalBR(0)).toBe('0,00')
  })

  it('usa ponto como separador de milhar', () => {
    expect(formatDecimalBR(1234.5)).toBe('1.234,50')
    expect(formatDecimalBR(1000000)).toBe('1.000.000,00')
  })

  it('respeita o número de casas pedido', () => {
    expect(formatDecimalBR(1.23456, 3)).toBe('1,235')
    expect(formatDecimalBR(2, 0)).toBe('2')
  })
})

describe('formatBRL', () => {
  // O Intl usa um espaço "não-quebrável" entre "R$" e o número (U+00A0 ou U+202F,
  // depende da versão do ICU). Normalizamos qualquer espaço para comparar o
  // conteúdo visível de forma estável entre ambientes.
  const norm = (s: string) => s.replace(/\s/g, ' ')

  it('formata como moeda brasileira com 2 casas', () => {
    expect(norm(formatBRL(12.5))).toBe('R$ 12,50')
    expect(norm(formatBRL(0))).toBe('R$ 0,00')
  })

  it('formata milhares com ponto de milhar', () => {
    expect(norm(formatBRL(1234.56))).toBe('R$ 1.234,56')
    expect(norm(formatBRL(1000000))).toBe('R$ 1.000.000,00')
  })

  it('trata null/undefined/NaN como zero', () => {
    expect(norm(formatBRL(null))).toBe('R$ 0,00')
    expect(norm(formatBRL(undefined))).toBe('R$ 0,00')
    expect(norm(formatBRL(NaN))).toBe('R$ 0,00')
  })
})

describe('formatQty', () => {
  it('remove casas decimais desnecessárias', () => {
    expect(formatQty(3)).toBe('3')
    expect(formatQty(2.5)).toBe('2,5')
  })

  it('usa ponto de milhar e vírgula decimal (até 3 casas)', () => {
    expect(formatQty(1000)).toBe('1.000')
    expect(formatQty(1234.567)).toBe('1.234,567')
  })
})

describe('formatBRL <-> parseNumber (ida e volta)', () => {
  it('parseNumber recupera o valor a partir do texto formatado em BRL', () => {
    for (const valor of [0, 12.5, 1234.56, 1000000]) {
      expect(parseNumber(formatBRL(valor))).toBe(valor)
    }
  })

  it('parseNumber recupera o valor a partir do texto formatado com formatDecimalBR', () => {
    for (const valor of [0, 12.5, 1234.5, 1000000]) {
      expect(parseNumber(formatDecimalBR(valor))).toBe(valor)
    }
  })
})

// Helpers de data: testamos invariantes/relações — nada de "hoje" hardcoded.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

describe('inicioDoDiaISO / fimDoDiaExclusivoISO', () => {
  it('ambos retornam ISO 8601 em UTC (Z)', () => {
    expect(inicioDoDiaISO('2026-03-15')).toMatch(ISO_RE)
    expect(fimDoDiaExclusivoISO('2026-03-15')).toMatch(ISO_RE)
  })

  it('o fim exclusivo é sempre estritamente maior que o início', () => {
    const ini = inicioDoDiaISO('2026-03-15')
    const fim = fimDoDiaExclusivoISO('2026-03-15')
    expect(new Date(fim).getTime()).toBeGreaterThan(new Date(ini).getTime())
  })

  it('o fim exclusivo é exatamente 24h após o início (dia sem DST)', () => {
    const ini = new Date(inicioDoDiaISO('2026-03-15')).getTime()
    const fim = new Date(fimDoDiaExclusivoISO('2026-03-15')).getTime()
    const UM_DIA = 24 * 60 * 60 * 1000
    expect(fim - ini).toBe(UM_DIA)
  })

  it('o início é a meia-noite local do dia informado', () => {
    const ini = new Date(inicioDoDiaISO('2026-03-15'))
    expect(ini.getFullYear()).toBe(2026)
    expect(ini.getMonth()).toBe(2) // março (0-indexado)
    expect(ini.getDate()).toBe(15)
    expect(ini.getHours()).toBe(0)
    expect(ini.getMinutes()).toBe(0)
    expect(ini.getSeconds()).toBe(0)
  })

  it('o fim exclusivo é a meia-noite local do dia SEGUINTE', () => {
    const fim = new Date(fimDoDiaExclusivoISO('2026-03-15'))
    expect(fim.getFullYear()).toBe(2026)
    expect(fim.getMonth()).toBe(2)
    expect(fim.getDate()).toBe(16)
    expect(fim.getHours()).toBe(0)
    expect(fim.getMinutes()).toBe(0)
    expect(fim.getSeconds()).toBe(0)
  })

  it('avança corretamente pela virada de mês', () => {
    const fim = new Date(fimDoDiaExclusivoISO('2026-01-31'))
    expect(fim.getMonth()).toBe(1) // fevereiro
    expect(fim.getDate()).toBe(1)
  })

  it('data inválida cai EXATAMENTE para hoje (não só um ISO qualquer)', () => {
    // Provar o comportamento de fallback: a saída para uma data inválida deve ser
    // idêntica à saída para hoje — não basta "parecer" ISO válido.
    expect(inicioDoDiaISO('data-invalida')).toBe(inicioDoDiaISO(hojeData()))
    expect(fimDoDiaExclusivoISO('data-invalida')).toBe(fimDoDiaExclusivoISO(hojeData()))
    // e continua sendo um ISO 8601 em UTC bem-formado
    expect(inicioDoDiaISO('data-invalida')).toMatch(ISO_RE)
    expect(fimDoDiaExclusivoISO('data-invalida')).toMatch(ISO_RE)
  })
})

describe('hojeData / hojeMaisDias', () => {
  it('hojeData retorna o formato yyyy-mm-dd', () => {
    expect(hojeData()).toMatch(YMD_RE)
  })

  it('hojeMaisDias(0) é igual a hoje', () => {
    expect(hojeMaisDias(0)).toBe(hojeData())
  })

  it('hojeMaisDias avança e retrocede N dias a partir de hoje', () => {
    const hoje = new Date(`${hojeData()}T00:00:00`).getTime()
    const UM_DIA = 24 * 60 * 60 * 1000

    const mais7 = new Date(`${hojeMaisDias(7)}T00:00:00`).getTime()
    expect(mais7 - hoje).toBe(7 * UM_DIA)

    const menos1 = new Date(`${hojeMaisDias(-1)}T00:00:00`).getTime()
    expect(hoje - menos1).toBe(UM_DIA)
  })

  it('hojeMaisDias sempre devolve yyyy-mm-dd válido', () => {
    expect(hojeMaisDias(45)).toMatch(YMD_RE)
    expect(hojeMaisDias(-45)).toMatch(YMD_RE)
  })
})

describe('primeiroDiaDoMes / ultimoDiaDoMes', () => {
  it('o primeiro dia é sempre o dia 01', () => {
    expect(primeiroDiaDoMes(0).slice(8)).toBe('01')
    expect(primeiroDiaDoMes(-1).slice(8)).toBe('01')
    expect(primeiroDiaDoMes(1).slice(8)).toBe('01')
  })

  it('ambos retornam yyyy-mm-dd válido', () => {
    expect(primeiroDiaDoMes(0)).toMatch(YMD_RE)
    expect(ultimoDiaDoMes(0)).toMatch(YMD_RE)
  })

  it('primeiro e último dia pertencem ao MESMO mês/ano', () => {
    for (const offset of [-2, -1, 0, 1, 2]) {
      const primeiro = primeiroDiaDoMes(offset)
      const ultimo = ultimoDiaDoMes(offset)
      expect(primeiro.slice(0, 7)).toBe(ultimo.slice(0, 7)) // yyyy-mm igual
    }
  })

  it('o último dia é >= o primeiro e cabe entre 28 e 31', () => {
    for (const offset of [-1, 0, 1]) {
      const primeiro = primeiroDiaDoMes(offset)
      const ultimo = ultimoDiaDoMes(offset)
      expect(ultimo >= primeiro).toBe(true)
      const diaFinal = Number(ultimo.slice(8))
      expect(diaFinal).toBeGreaterThanOrEqual(28)
      expect(diaFinal).toBeLessThanOrEqual(31)
    }
  })

  it('o dia SEGUINTE ao último dia é o primeiro dia do próximo mês', () => {
    const ultimo = new Date(`${ultimoDiaDoMes(0)}T00:00:00`)
    const proximo = new Date(ultimo)
    proximo.setDate(proximo.getDate() + 1)
    expect(proximo.getDate()).toBe(1)
  })
})
