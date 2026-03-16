// Wolf-Fin Risk State Store — per-market daily P&L tracker

import type { RiskState } from '../adapters/types.js'

const MAX_DAILY_LOSS_USD = parseFloat(process.env.MAX_DAILY_LOSS_USD ?? '200')
const MAX_POSITION_USD = parseFloat(process.env.MAX_POSITION_USD ?? '1000')
const MAX_COMBINED_NOTIONAL_USD = parseFloat(process.env.MAX_COMBINED_NOTIONAL_USD ?? '2000')

type Market = 'crypto' | 'forex'

interface DayState {
  date: string
  realizedPnlUsd: number
  peakPnlUsd: number
  positionNotionalUsd: number
}

// ── Forex context cache — populated by agent on each get_snapshot ──────────────

export interface ForexContext {
  spread: number
  sessionOpen: boolean
  pipValue: number
}

let lastForexContext: ForexContext = { spread: 0, sessionOpen: false, pipValue: 0.0001 }

export function setForexContext(ctx: ForexContext): void {
  lastForexContext = ctx
}

export function getForexContext(): ForexContext {
  return lastForexContext
}

// ── Per-market day state ───────────────────────────────────────────────────────

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

function freshState(): DayState {
  return { date: utcDateString(), realizedPnlUsd: 0, peakPnlUsd: 0, positionNotionalUsd: 0 }
}

const states: Record<Market, DayState> = {
  crypto: freshState(),
  forex: freshState(),
}

function get(market: Market): DayState {
  if (states[market].date !== utcDateString()) states[market] = freshState()
  return states[market]
}

/** Restore daily P&L from DB on server restart so the loss limit survives restarts. */
export function hydrateRiskStateFromDb(market: Market, pnlUsd: number): void {
  const s = get(market)
  s.realizedPnlUsd = pnlUsd
  if (pnlUsd > s.peakPnlUsd) s.peakPnlUsd = pnlUsd
}

export function recordFillFor(market: Market, pnlUsd: number): void {
  const s = get(market)
  s.realizedPnlUsd += pnlUsd
  if (s.realizedPnlUsd > s.peakPnlUsd) s.peakPnlUsd = s.realizedPnlUsd
}

export function updatePositionNotionalFor(market: Market, notionalUsd: number): void {
  get(market).positionNotionalUsd = notionalUsd
}

export function getRiskStateFor(market: Market): RiskState {
  const s = get(market)
  const dailyLoss = Math.min(0, s.realizedPnlUsd)
  return {
    dailyPnlUsd: s.realizedPnlUsd,
    remainingBudgetUsd: Math.max(0, MAX_DAILY_LOSS_USD + dailyLoss),
    positionNotionalUsd: s.positionNotionalUsd,
  }
}

export function isDailyLimitHitFor(market: Market): boolean {
  return get(market).realizedPnlUsd <= -MAX_DAILY_LOSS_USD
}

/** Sum of open position notional across all markets. */
export function getCombinedNotionalUsd(): number {
  return get('crypto').positionNotionalUsd + get('forex').positionNotionalUsd
}

export { MAX_DAILY_LOSS_USD, MAX_POSITION_USD, MAX_COMBINED_NOTIONAL_USD }
