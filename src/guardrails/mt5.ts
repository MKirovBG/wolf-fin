// Wolf-Fin MT5 Guardrails — validateMt5Order

import type { OrderParams } from '../adapters/types.js'
import type { ValidationResult } from './validate.js'
import type { GuardrailsConfig } from '../types.js'
import {
  getRiskStateFor,
  getCombinedNotionalUsd,
  MAX_COMBINED_NOTIONAL_USD,
} from './riskStateStore.js'

// MAX_SPREAD_PIPS removed — spread validation now uses dollar cost (spreadUsd) to handle
// commodity symbols like XAUUSD where normal spreads are 20-500 points, not 1-3 pips.

/**
 * Validate an MT5 order before sending to the bridge.
 * Follows the same pattern as validateForexOrder for forex-class symbols.
 */
export function validateMt5Order(
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
    return { ok: false, reason: 'MT5 market session is closed — order rejected' }
  }

  // 2. Spread sanity check — only blocks clearly broken/extreme conditions (e.g. bridge glitch,
  //    weekend gap open). Normal spread decisions are left to the agent which sees live spread
  //    in the snapshot summary on every tick.
  const spreadUsd = spread * pipValue  // cost in $ per lot
  const EXTREME_SPREAD_USD = 500        // $500/lot = ~500 pips on XAUUSD — clearly abnormal
  if (g.extremeSpreadCheck && spreadUsd > EXTREME_SPREAD_USD) {
    return {
      ok: false,
      reason: `Spread $${spreadUsd.toFixed(2)}/lot is abnormally wide — possible data issue or market closed. Skipping order.`,
    }
  }

  // 3. stopPips required (respects toggle)
  if (g.stopPipsRequired && params.stopPips == null) {
    return { ok: false, reason: 'MT5 orders require stopPips (use ATR-based distance)' }
  }

  // 4. Pip-based risk: volume × pipValue × stopPips <= remainingBudget
  if (params.stopPips != null) {
    const pipRiskUsd = params.quantity * pipValue * params.stopPips
    const risk = getRiskStateFor('mt5')
    if (pipRiskUsd > risk.remainingBudgetUsd && risk.remainingBudgetUsd > 0) {
      return {
        ok: false,
        reason: `Pip risk $${pipRiskUsd.toFixed(2)} exceeds remaining MT5 budget $${risk.remainingBudgetUsd.toFixed(2)}`,
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
