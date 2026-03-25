// Wolf-Fin Guardrails — risk checks, position limits, circuit breakers
// Single entry point: import everything from here instead of individual modules.

import type { OrderParams } from '../adapters/types.js'
import type { GuardrailsConfig } from '../types.js'
import { validateOrder } from './validate.js'
import { validateMt5Order } from './mt5.js'
import type { ValidationResult } from './validate.js'

export * from './riskStateStore.js'
export * from './validate.js'
export * from './mt5.js'

// ── Unified validation entry point ───────────────────────────────────────────

export type ValidateCtx =
  | { market: 'crypto'; price: number }
  | { market: 'mt5'; spread: number; sessionOpen: boolean; pipValue: number; guardrails?: Partial<GuardrailsConfig> }

/** Dispatches to the correct market validator. Single import point for all order validation. */
export function validateForMarket(params: OrderParams, ctx: ValidateCtx): ValidationResult {
  if (ctx.market === 'mt5') {
    return validateMt5Order(params, ctx.spread, ctx.sessionOpen, ctx.pipValue, ctx.guardrails)
  }
  return validateOrder(params, ctx.price)
}
