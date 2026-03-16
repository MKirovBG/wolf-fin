// Wolf-Fin MT5 Guardrails — validateMt5Order

import type { OrderParams } from '../adapters/types.js'
import type { ValidationResult } from './validate.js'
import {
  getRiskStateFor,
  isDailyLimitHitFor,
  getCombinedNotionalUsd,
  MAX_COMBINED_NOTIONAL_USD,
} from './riskStateStore.js'

const MAX_SPREAD_PIPS = parseFloat(process.env.MAX_SPREAD_PIPS ?? '3')
const MIN_STOP_PIPS = parseFloat(process.env.MIN_STOP_PIPS ?? '10')

/**
 * Validate an MT5 order before sending to the bridge.
 * Follows the same pattern as validateForexOrder for forex-class symbols.
 */
export function validateMt5Order(
  params: OrderParams,
  spread: number,
  sessionOpen: boolean,
  pipValue: number,
): ValidationResult {
  // 1. Daily loss gate
  if (isDailyLimitHitFor('mt5')) {
    return { ok: false, reason: 'MT5 daily loss limit reached — trading halted for today' }
  }

  // 2. Session must be open
  if (!sessionOpen) {
    return { ok: false, reason: 'MT5 market session is closed — order rejected' }
  }

  // 3. Spread check
  if (spread > MAX_SPREAD_PIPS) {
    return {
      ok: false,
      reason: `Spread ${spread.toFixed(1)} pips exceeds maximum ${MAX_SPREAD_PIPS} pips`,
    }
  }

  // 4. stopPips required and must meet minimum
  if (params.stopPips == null) {
    return { ok: false, reason: 'MT5 orders require stopPips (use ATR-based distance)' }
  }
  if (params.stopPips < MIN_STOP_PIPS) {
    return {
      ok: false,
      reason: `stopPips ${params.stopPips} below minimum ${MIN_STOP_PIPS} — stop too tight`,
    }
  }

  // 5. Pip-based risk: volume × pipValue × stopPips <= remainingBudget
  const pipRiskUsd = params.quantity * pipValue * params.stopPips
  const risk = getRiskStateFor('mt5')
  if (pipRiskUsd > risk.remainingBudgetUsd) {
    return {
      ok: false,
      reason: `Pip risk $${pipRiskUsd.toFixed(2)} exceeds remaining MT5 budget $${risk.remainingBudgetUsd.toFixed(2)}`,
    }
  }

  // 6. Combined notional cap across all markets (buys only)
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
