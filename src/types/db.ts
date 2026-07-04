// Tipos que espelham o schema do banco (Fase 1).

export type UserRole = 'admin' | 'funcionario'
export type ProductUnit = 'un' | 'cento' | 'kg'
export type MovementType = 'entrada' | 'saida' | 'ajuste' | 'venda' | 'cancelamento'
export type CashStatus = 'aberto' | 'fechado'
export type CashMovementType = 'sangria' | 'suprimento'
export type PaymentMethod = 'dinheiro' | 'pix' | 'debito' | 'credito'
export type SaleStatus = 'concluida' | 'cancelada'

export interface Profile {
  id: string
  nome: string
  usuario: string
  role: UserRole
  ativo: boolean
  created_at: string
}

export interface Category {
  id: string
  nome: string
  ordem: number
  created_at: string
}

export interface Product {
  id: string
  nome: string
  categoria_id: string | null
  preco_venda: number
  custo: number | null
  unidade: ProductUnit
  controla_estoque: boolean
  estoque_atual: number
  estoque_minimo: number
  ativo: boolean
  imagem_url: string | null
  created_at: string
  updated_at: string
}

export interface StockMovement {
  id: string
  product_id: string
  tipo: MovementType
  quantidade: number
  estoque_apos: number | null
  motivo: string | null
  referencia_id: string | null
  usuario_id: string | null
  created_at: string
}

export interface CashSession {
  id: string
  funcionario_id: string
  valor_abertura: number
  valor_fechamento_informado: number | null
  valor_fechamento_calculado: number | null
  aberto_em: string
  fechado_em: string | null
  status: CashStatus
  observacao: string | null
}

export interface CashMovement {
  id: string
  cash_session_id: string
  tipo: CashMovementType
  valor: number
  motivo: string | null
  usuario_id: string | null
  created_at: string
}

export interface Sale {
  id: string
  cash_session_id: string | null
  funcionario_id: string
  cliente_nome: string | null
  subtotal: number
  desconto: number
  total: number
  forma_pagamento: PaymentMethod
  valor_recebido: number | null
  troco: number | null
  status: SaleStatus
  created_at: string
}

export interface SaleItem {
  id: string
  sale_id: string
  product_id: string | null
  product_nome: string
  quantidade: number
  preco_unitario: number
  subtotal: number
}

export interface CaixaResumo {
  valor_abertura: number
  vendas_dinheiro: number
  vendas_outras: number
  suprimentos: number
  sangrias: number
  esperado_dinheiro: number
  informado: number | null
  diferenca: number | null
}

// ---------------- Encomendas ----------------
export type OrderStatus = 'pendente' | 'entregue' | 'pago' | 'cancelado'
export type OrderOrigin = 'balcao' | 'online'
export type DeliveryType = 'retirada' | 'entrega'
export type OrderPaymentMethod =
  | 'dinheiro' | 'pix' | 'debito' | 'credito' | 'transferencia' | 'boleto' | 'outro'

export interface Order {
  id: string
  origem: OrderOrigin
  cliente_nome: string
  cliente_whatsapp: string | null
  descricao: string | null
  observacao: string | null
  tipo_entrega: DeliveryType
  endereco: string | null
  taxa_entrega: number
  subtotal: number
  total: number
  status: OrderStatus
  data_agendada: string | null
  hora_agendada: string | null
  data_prevista_pagamento: string | null
  data_entrega: string | null
  data_pagamento: string | null
  forma_pagamento: OrderPaymentMethod | null
  funcionario_id: string | null
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string | null
  product_nome: string
  quantidade: number
  preco_unitario: number
  subtotal: number
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pendente: 'Pendente',
  entregue: 'Entregue (a receber)',
  pago: 'Pago',
  cancelado: 'Cancelado',
}

export const ORDER_PAYMENT_LABELS: Record<OrderPaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Cartão Débito',
  credito: 'Cartão Crédito',
  transferencia: 'Transferência',
  boleto: 'Boleto',
  outro: 'Outro',
}

// ---------------- Comandas ----------------
export type ComandaStatus = 'aberta' | 'fechada' | 'cancelada'

export interface Comanda {
  id: string
  nome: string
  status: ComandaStatus
  funcionario_id: string | null
  cash_session_id: string | null
  sale_id: string | null
  observacao: string | null
  aberta_em: string
  fechada_em: string | null
  created_at: string
}

export interface ComandaItem {
  id: string
  comanda_id: string
  product_id: string | null
  product_nome: string
  quantidade: number
  preco_unitario: number
  custo_unitario: number | null
  subtotal: number
  usuario_id: string | null
  created_at: string
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Cartão Débito',
  credito: 'Cartão Crédito',
}

export const UNIT_LABELS: Record<ProductUnit, string> = {
  un: 'Unidade',
  cento: 'Cento',
  kg: 'Quilo',
}
