// Wolf-Fin Guardrails — pre-execution order validation

import type { OrderParams } from '../adapters/types.js'
import { MAX_POSITION_USD, getRiskState } from './riskState.js'

// Binance spot minimum order sizes — configurable via .env or per-symbol in future
// Defaults match Binance BTCUSDT minimums; adjust for other pairs via environment.
const MIN_NOTIONAL_USD = parseFloat(process.env.MIN_ORDER_NOTIONAL_USD ?? '10')
const MIN_QTY          = parseFloat(process.env.MIN_ORDER_QTY           ?? '0.00001')
const MAX_QTY          = parseFloat(process.env.MAX_ORDER_QTY           ?? '9000')

export interface ValidationResult {
  ok: boolean
  reason?: string
}

/**
 * Validate an order before sending to Binance.
 * Returns { ok: true } when the order passes all checks, or { ok: false, reason } otherwise.
 */
export function validateOrder(params: OrderParams, currentPrice: number): ValidationResult {
  // 1. Quantity sanity
  if (params.quantity <= 0) {
    return { ok: false, reason: `Invalid quantity: ${params.quantity}` }
  }
  if (params.quantity < MIN_QTY) {
    return { ok: false, reason: `Quantity ${params.quantity} below minimum ${MIN_QTY}` }
  }
  if (params.quantity > MAX_QTY) {
    return { ok: false, reason: `Quantity ${params.quantity} exceeds maximum ${MAX_QTY}` }
  }

  // 2. Minimum notional (price × qty >= MIN_NOTIONAL_USD)
  const price = params.price ?? currentPrice
  const notional = price * params.quantity
  if (notional < MIN_NOTIONAL_USD) {
    return {
      ok: false,
      reason: `Order notional $${notional.toFixed(2)} below minimum $${MIN_NOTIONAL_USD}`,
    }
  }

  // 3. Maximum position size
  const risk = getRiskState()
  const projectedNotional =
    params.side === 'BUY'
      ? risk.positionNotionalUsd + notional
      : risk.positionNotionalUsd - notional

  if (projectedNotional > MAX_POSITION_USD) {
    return {
      ok: false,
      reason: `Order would bring position to $${projectedNotional.toFixed(2)}, exceeding limit $${MAX_POSITION_USD}`,
    }
  }

  // 4. LIMIT orders must have a price
  if (params.type === 'LIMIT' && (params.price == null || params.price <= 0)) {
    return { ok: false, reason: 'LIMIT order missing valid price' }
  }

  return { ok: true }
}
