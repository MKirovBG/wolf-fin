// Monte Carlo simulation engine — fully scriptable, zero LLM involvement.
// Bootstraps price paths from real M1 candle returns and applies SL/TP rules
// to produce per-action probability tables on every agent tick.

import type { Candle } from './types.js'

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface MCActionResult {
  winRate: number          // % of paths that hit TP before SL (0-100)
  ev: number               // expected value in account currency $
  p10: number              // 10th-percentile P&L (worst 10% of scenarios)
  p50: number              // median P&L
  p90: number              // 90th-percentile P&L (best 10%)
  slHitPct: number         // % of paths where SL was hit first
  medianBarsToClose: number // median bars until position closes (TP or SL)
}

export interface MCResult {
  long:        MCActionResult
  short:       MCActionResult
  recommended: 'LONG' | 'SHORT' | 'HOLD'
  edgeDelta:   number   // EV(best action) - EV(HOLD ~0) — how strong the signal is
  pathCount:   number
  barsForward: number
  generatedAt: number
}

export interface MCInputs {
  // Multi-timeframe candles — engine uses M1 as the path engine, higher TFs for regime bias
  m1:  Candle[]
  m5:  Candle[]
  m15: Candle[]
  m30: Candle[]
  h1:  Candle[]
  h4:  Candle[]

  currentPrice: number
  pipSize:  number   // e.g. 1.0 for XAUUSD, 0.0001 for EURUSD
  pipValue: number   // $ per pip per 1 lot
  lotSize:  number   // proposed trade size in lots
  atr14:    number   // from indicators — used as SL/TP distance base
  ema20:    number
  ema50:    number
}

// ── Configuration ─────────────────────────────────────────────────────────────

const PATH_COUNT   = 5_000   // number of simulated paths per action
const BARS_FORWARD = 60      // bars forward (M1 → 60 minutes look-ahead)
const SL_ATR_MULT  = 1.0     // SL = 1× ATR
const TP_ATR_MULT  = 1.5     // TP = 1.5× ATR  (R:R = 1.5)
const MIN_CANDLES  = 30      // minimum M1 candles required to run simulation

// ── Helper: extract log returns from candle closes ───────────────────────────

function logReturns(candles: Candle[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close
    const curr = candles[i].close
    if (prev > 0) returns.push(Math.log(curr / prev))
  }
  return returns
}

// ── Helper: percentile from sorted array ─────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor((p / 100) * (sorted.length - 1))
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]
}

// ── Helper: median of unsorted array ─────────────────────────────────────────

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  return percentile(sorted, 50)
}

// ── Regime bias: weight the return distribution using higher TF trend ─────────
// If EMA20 > EMA50 (bullish), shift long-path returns slightly positive;
// If EMA20 < EMA50 (bearish), shift short-path returns slightly positive.
// Magnitude is capped at 0.5× the return std-dev to avoid over-fitting.

function regimeBias(returns: number[], ema20: number, ema50: number): number {
  if (returns.length === 0) return 0
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
  const stdDev = Math.sqrt(variance)
  const trendStrength = Math.abs(ema20 - ema50) / ((ema20 + ema50) / 2)
  const biasMagnitude = Math.min(stdDev * 0.5, trendStrength * stdDev)
  return ema20 > ema50 ? biasMagnitude : -biasMagnitude
}

// ── Core simulation: one action direction ─────────────────────────────────────

function simulateAction(
  direction: 'LONG' | 'SHORT',
  returns: number[],
  startPrice: number,
  slDist: number,    // SL distance in price units
  tpDist: number,    // TP distance in price units
  pipSize: number,
  pipValue: number,
  lotSize: number,
  bias: number,      // regime bias applied per bar
): MCActionResult {
  const slPrice = direction === 'LONG'
    ? startPrice - slDist
    : startPrice + slDist
  const tpPrice = direction === 'LONG'
    ? startPrice + tpDist
    : startPrice - tpDist

  const slPips   = slDist / pipSize
  const tpPips   = tpDist / pipSize
  const lossPerLot   = slPips * pipValue
  const profitPerLot = tpPips * pipValue
  const lossTotal    = lossPerLot * lotSize
  const profitTotal  = profitPerLot * lotSize

  let tpHits = 0
  let slHits = 0
  const pnlResults: number[]   = []
  const barsToClose: number[]  = []

  const n = returns.length

  for (let sim = 0; sim < PATH_COUNT; sim++) {
    let price = startPrice
    let closed = false

    for (let bar = 0; bar < BARS_FORWARD; bar++) {
      // Bootstrap: sample a random historical return
      const r = returns[Math.floor(Math.random() * n)] + bias
      price = price * Math.exp(r)

      const hitSL = direction === 'LONG' ? price <= slPrice : price >= slPrice
      const hitTP = direction === 'LONG' ? price >= tpPrice : price <= tpPrice

      if (hitTP) {
        tpHits++
        pnlResults.push(profitTotal)
        barsToClose.push(bar + 1)
        closed = true
        break
      }
      if (hitSL) {
        slHits++
        pnlResults.push(-lossTotal)
        barsToClose.push(bar + 1)
        closed = true
        break
      }
    }

    // Path didn't close within BARS_FORWARD — mark as open, P&L = current vs entry
    if (!closed) {
      const openPnlPips = direction === 'LONG'
        ? (price - startPrice) / pipSize
        : (startPrice - price) / pipSize
      pnlResults.push(openPnlPips * pipValue * lotSize)
      barsToClose.push(BARS_FORWARD)
    }
  }

  const sorted = [...pnlResults].sort((a, b) => a - b)
  const ev     = pnlResults.reduce((s, v) => s + v, 0) / PATH_COUNT

  return {
    winRate:          (tpHits / PATH_COUNT) * 100,
    ev,
    p10:              percentile(sorted, 10),
    p50:              percentile(sorted, 50),
    p90:              percentile(sorted, 90),
    slHitPct:         (slHits / PATH_COUNT) * 100,
    medianBarsToClose: median(barsToClose),
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

export function runMonteCarlo(inputs: MCInputs): MCResult | null {
  const { m1, ema20, ema50, currentPrice, pipSize, pipValue, lotSize, atr14 } = inputs

  // Need enough M1 candles to bootstrap from
  if (m1.length < MIN_CANDLES) return null
  if (currentPrice <= 0 || pipSize <= 0 || pipValue <= 0 || atr14 <= 0) return null

  const returns = logReturns(m1)
  if (returns.length < MIN_CANDLES) return null

  const bias   = regimeBias(returns, ema20, ema50)
  const slDist = atr14 * SL_ATR_MULT
  const tpDist = atr14 * TP_ATR_MULT

  const long  = simulateAction('LONG',  returns, currentPrice, slDist, tpDist, pipSize, pipValue, lotSize, bias)
  const short = simulateAction('SHORT', returns, currentPrice, slDist, tpDist, pipSize, pipValue, lotSize, -bias)

  // Recommend the action with higher positive EV; HOLD if both are negative
  let recommended: 'LONG' | 'SHORT' | 'HOLD'
  const bestEv = Math.max(long.ev, short.ev)
  if (bestEv <= 0) {
    recommended = 'HOLD'
  } else {
    recommended = long.ev >= short.ev ? 'LONG' : 'SHORT'
  }

  return {
    long,
    short,
    recommended,
    edgeDelta:   bestEv,
    pathCount:   PATH_COUNT,
    barsForward: BARS_FORWARD,
    generatedAt: Date.now(),
  }
}

// ── Format MC result as a compact text block for the agent snapshot ───────────

export function formatMCBlock(mc: MCResult, pipSize: number, dp: number): string {
  const fmt = (v: number) => (v >= 0 ? `+$${v.toFixed(0)}` : `-$${Math.abs(v).toFixed(0)}`)
  const pct  = (v: number) => `${v.toFixed(1)}%`

  const header = `MONTE CARLO  (${mc.pathCount.toLocaleString()} paths · M1 · ${mc.barsForward}-bar fwd · SL=${SL_ATR_MULT}×ATR TP=${TP_ATR_MULT}×ATR):`
  const colHdr = `  Action   Win%    EV      P10     P50     P90    SL hit%  Med.bars`
  const sep    = `  ${'─'.repeat(65)}`

  const row = (label: string, r: MCActionResult, arrow: string) =>
    `  ${label.padEnd(7)}  ${pct(r.winRate).padStart(5)}  ${fmt(r.ev).padStart(6)}  ${fmt(r.p10).padStart(6)}  ${fmt(r.p50).padStart(6)}  ${fmt(r.p90).padStart(6)}  ${pct(r.slHitPct).padStart(6)}  ${r.medianBarsToClose.toFixed(0).padStart(4)}m ${arrow}`

  const longArrow  = mc.recommended === 'LONG'  ? '← recommended' : ''
  const shortArrow = mc.recommended === 'SHORT' ? '← recommended' : ''
  const holdNote   = mc.recommended === 'HOLD'
    ? `  ⚠ Both directions have negative EV — recommended: HOLD`
    : `  Edge delta: ${fmt(mc.edgeDelta)} vs HOLD`

  return [header, colHdr, sep, row('LONG', mc.long, longArrow), row('SHORT', mc.short, shortArrow), sep, holdNote].join('\n')
}
