// Wolf-Fin Risk State — backward-compat shim; state is now tracked per-market in riskStateStore.ts

import type { RiskState } from '../adapters/types.js'
import {
  getRiskStateFor,
  recordFillFor,
  updatePositionNotionalFor,
  isDailyLimitHitFor,
  MAX_DAILY_LOSS_USD,
  MAX_POSITION_USD,
} from './riskStateStore.js'

export { MAX_DAILY_LOSS_USD, MAX_POSITION_USD }

/** Record a closed crypto trade P&L. Use recordFillFor(market, pnl) for per-market tracking. */
export function recordFill(pnlUsd: number): void {
  recordFillFor('crypto', pnlUsd)
}

/** Update crypto position notional. Use updatePositionNotionalFor(market, n) for per-market tracking. */
export function updatePositionNotional(notionalUsd: number): void {
  updatePositionNotionalFor('crypto', notionalUsd)
}

/** Returns risk state for the crypto market. */
export function getRiskState(): RiskState {
  return getRiskStateFor('crypto')
}

/** True when the crypto daily loss limit is hit. */
export function isDailyLimitHit(): boolean {
  return isDailyLimitHitFor('crypto')
}
