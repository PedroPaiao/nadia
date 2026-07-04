import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Combina classes do Tailwind resolvendo conflitos. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Formata um número como moeda brasileira (R$). */
export function formatBRL(value: number | null | undefined): string {
  const n = typeof value === 'number' && !Number.isNaN(value) ? value : 0
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Converte um texto digitado (ex.: "12,50" ou "1.234,56") para número, no padrão pt-BR. */
export function parseNumber(input: string | number): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0
  if (!input) return 0
  let s = String(input).trim().replace(/[^\d.,-]/g, '')
  if (s.includes(',')) {
    // vírgula é o separador decimal; pontos são milhares
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    // só pontos: mais de um => milhares; um único => decimal
    const pontos = (s.match(/\./g) || []).length
    if (pontos > 1) s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** Formata um número com casas fixas no padrão pt-BR (ex.: 12,50). */
export function formatDecimalBR(value: number, casas = 2): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

/**
 * Normaliza um login: remove acentos, espaços e caracteres inválidos,
 * mantendo apenas [a-z0-9._-]. Usado tanto na criação quanto no login,
 * para casar com o e-mail sintético interno.
 */
export function normalizeUsuario(input: string): string {
  return (input || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
}

/** Formata quantidade removendo casas decimais desnecessárias. */
export function formatQty(value: number): string {
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

const UNIDADE_LABELS: Record<string, string> = {
  un: 'un',
  cento: 'cento',
  kg: 'kg',
}

export function unidadeLabel(unidade: string): string {
  return UNIDADE_LABELS[unidade] ?? unidade
}

/** Data de hoje no formato yyyy-mm-dd (horário local). */
export function hojeData(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Início do dia (00:00 local) como ISO. Volta para hoje se a data for inválida. */
export function inicioDoDiaISO(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T00:00:00`)
  if (Number.isNaN(d.getTime())) return new Date(`${hojeData()}T00:00:00`).toISOString()
  return d.toISOString()
}

/** Início do dia SEGUINTE (limite superior exclusivo) como ISO. */
export function fimDoDiaExclusivoISO(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T00:00:00`)
  if (Number.isNaN(d.getTime())) d.setTime(new Date(`${hojeData()}T00:00:00`).getTime())
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}

/** Máscara de telefone pt-BR: (00) 00000-0000 (aceita fixo e celular). */
export function maskTelefone(input: string): string {
  const d = (input || '').replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/** Formata uma data 'yyyy-mm-dd' (ou ISO) como dd/mm/aaaa, sem deslocamento de fuso. */
export function formatDataBR(d: string | null | undefined): string {
  if (!d) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return new Date(d).toLocaleDateString('pt-BR')
}

/** Formata um objeto Date como yyyy-mm-dd (local). */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/** Data de hoje + N dias no formato yyyy-mm-dd. */
export function hojeMaisDias(dias: number): string {
  const d = new Date(`${hojeData()}T00:00:00`)
  d.setDate(d.getDate() + dias)
  return toISODate(d)
}

/** Primeiro dia do mês (offset em meses, 0 = mês atual). */
export function primeiroDiaDoMes(offset = 0): string {
  const n = new Date(`${hojeData()}T00:00:00`)
  return toISODate(new Date(n.getFullYear(), n.getMonth() + offset, 1))
}

/** Último dia do mês (offset em meses). */
export function ultimoDiaDoMes(offset = 0): string {
  const n = new Date(`${hojeData()}T00:00:00`)
  return toISODate(new Date(n.getFullYear(), n.getMonth() + offset + 1, 0))
}

/** Formata data+hora curta em pt-BR. */
export function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
