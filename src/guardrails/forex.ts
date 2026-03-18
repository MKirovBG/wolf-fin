// Wolf-Fin Forex Guardrails — validateForexOrder

import type { OrderParams } from '../adapters/types.js'
import type { ValidationResult } from './validate.js'
import type { GuardrailsConfig } from '../types.js'
import {
  getRiskStateFor,
  getCombinedNotionalUsd,
  MAX_COMBINED_NOTIONAL_USD,
} from './riskStateStore.js'

const MAX_SPREAD_PIPS = parseFloat(process.env.MAX_SPREAD_PIPS ?? '3')

/**
 * Validate a forex order before sending to Alpaca.
 *
 * @param params    - Order parameters (symbol, side, qty, price, stopPips)
 * @param spread    - Current bid/ask spread in pips (from last snapshot)
 * @param sessionOpen - Whether a major forex session is currently active
 * @param pipValue  - USD value per pip per unit (from Alpaca adapter)
 * @param guardrails - Optional guardrails config overrides
 */
export function validateForexOrder(
  params: OrderParams,
  spread: number,
  sessionOpen: boolean,
  pipValue: number,
  guardrails?: Partial<GuardrailsConfig>,
): ValidationResult {
  const g: GuardrailsConfig = {
    sessionOpenCheck: true,
    extremeSpreadCheck: true,
    stopPipsRequired: true,
    ...guardrails,
  }

  // 1. Session must be open (respects toggle)
  if (g.sessionOpenCheck && !sessionOpen) {
    return { ok: false, reason: 'Forex market session is closed — order rejected' }
  }

  // 2. Spread check (respects toggle)
  if (g.extremeSpreadCheck && spread > MAX_SPREAD_PIPS) {
    return {
      ok: false,
      reason: `Spread ${spread.toFixed(1)} pips exceeds maximum ${MAX_SPREAD_PIPS} pips`,
    }
  }

  // 3. stopPips required (respects toggle)
  if (g.stopPipsRequired && params.stopPips == null) {
    return { ok: false, reason: 'Forex orders require stopPips (use ATR-based distance)' }
  }

  // 4. Pip-based risk: units × pipValue × stopPips <= remainingBudget
  if (params.stopPips != null) {
    const pipRiskUsd = params.quantity * pipValue * params.stopPips
    const risk = getRiskStateFor('forex')
    if (pipRiskUsd > risk.remainingBudgetUsd && risk.remainingBudgetUsd > 0) {
      return {
        ok: false,
        reason: `Pip risk $${pipRiskUsd.toFixed(2)} exceeds remaining forex budget $${risk.remainingBudgetUsd.toFixed(2)}`,
      }
    }
  }

  // 5. Combined notional cap across all markets (buys only)
  if (params.side === 'BUY') {
    const orderNotional = params.quantity * (params.price ?? 1)
    const projected = getCombinedNotionalUsd() + orderNotional
    if (projected > MAX_COMBINED_NOTIONAL_USD) {
      return {
        ok: false,
        reason: `Combined notional $${projected.toFixed(2)} would exceed cap $${MAX_COMBINED_NOTIONAL_USD}`,
      }
    }
  }

  return { ok: true }
}
