// Wolf-Fin Risk State — daily P&L tracker and budget gate

import type { RiskState } from '../adapters/types.js'

const MAX_DAILY_LOSS_USD = parseFloat(process.env.MAX_DAILY_LOSS_USD ?? '200')
const MAX_POSITION_USD = parseFloat(process.env.MAX_POSITION_USD ?? '1000')

interface DayState {
  date: string          // UTC date string, e.g. "2026-03-14"
  realizedPnlUsd: number
  peakPnlUsd: number    // for max drawdown tracking
  positionNotionalUsd: number
}

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

let state: DayState = {
  date: utcDateString(),
  realizedPnlUsd: 0,
  peakPnlUsd: 0,
  positionNotionalUsd: 0,
}

function resetIfNewDay(): void {
  const today = utcDateString()
  if (state.date !== today) {
    state = {
      date: today,
      realizedPnlUsd: 0,
      peakPnlUsd: 0,
      positionNotionalUsd: 0,
    }
  }
}

/** Record a closed trade P&L (positive = profit, negative = loss). */
export function recordFill(pnlUsd: number): void {
  resetIfNewDay()
  state.realizedPnlUsd += pnlUsd
  if (state.realizedPnlUsd > state.peakPnlUsd) {
    state.peakPnlUsd = state.realizedPnlUsd
  }
}

/** Update the current open position notional (mark-to-market USD value). */
export function updatePositionNotional(notionalUsd: number): void {
  state.positionNotionalUsd = notionalUsd
}

/** Return the current RiskState snapshot for injection into MarketSnapshot. */
export function getRiskState(): RiskState {
  resetIfNewDay()
  const dailyLoss = Math.min(0, state.realizedPnlUsd) // only count losses
  const remainingBudgetUsd = MAX_DAILY_LOSS_USD + dailyLoss // budget shrinks as losses accumulate
  return {
    dailyPnlUsd: state.realizedPnlUsd,
    remainingBudgetUsd: Math.max(0, remainingBudgetUsd),
    positionNotionalUsd: state.positionNotionalUsd,
  }
}

/** True when the daily loss limit has been hit. */
export function isDailyLimitHit(): boolean {
  resetIfNewDay()
  return state.realizedPnlUsd <= -MAX_DAILY_LOSS_USD
}

export { MAX_DAILY_LOSS_USD, MAX_POSITION_USD }
