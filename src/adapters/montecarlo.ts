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

// ── Helper: extract wick ratio distributions from M1 candles ─────────────────
// wickUp  = (high - close) / close   — how far price spiked above the close
// wickDown = (close - low) / close   — how far price dipped below the close
// These are sampled per simulated bar to model intra-bar SL/TP piercing.

interface WickDistribution { up: number[]; down: number[] }

function wickDistribution(candles: Candle[]): WickDistribution {
  const up: number[] = []
  const down: number[] = []
  for (const c of candles) {
    if (c.close <= 0) continue
    up.push((c.high - c.close) / c.close)
    down.push((c.close - c.low) / c.close)
  }
  return { up, down }
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

// ── Regime bias: weight the return distribution using multi-TF trend ──────────
// Combines H1 EMA cross with H1 and H4 log-return trends for confluence.
// When M1, H1, and H4 trends align, bias magnitude increases.
// When they diverge, bias is reduced. Capped at 0.5× M1 std-dev.

function returnStats(returns: number[]): { mean: number; stdDev: number } {
  if (returns.length === 0) return { mean: 0, stdDev: 0 }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
  return { mean, stdDev: Math.sqrt(variance) }
}

function multiTFRegimeBias(
  m1Returns: number[],
  h1Candles: Candle[],
  h4Candles: Candle[],
  ema20: number,
  ema50: number,
): number {
  const { stdDev: m1Std } = returnStats(m1Returns)
  if (m1Std === 0) return 0

  // H1 EMA cross direction (primary signal)
  const h1Signal = ema20 > ema50 ? 1 : -1

  // H1 log-return trend direction
  const h1Returns = logReturns(h1Candles)
  const { mean: h1Mean } = returnStats(h1Returns)
  const h1ReturnSignal = h1Mean > 0 ? 1 : h1Mean < 0 ? -1 : 0

  // H4 log-return trend direction
  const h4Returns = logReturns(h4Candles)
  const { mean: h4Mean } = returnStats(h4Returns)
  const h4ReturnSignal = h4Mean > 0 ? 1 : h4Mean < 0 ? -1 : 0

  // Confluence: sum of signals (-3 to +3)
  const confluence = h1Signal + h1ReturnSignal + h4ReturnSignal

  // Scale bias by confluence strength (0 = divergent, ±3 = fully aligned)
  const trendStrength = Math.abs(ema20 - ema50) / ((ema20 + ema50) / 2)
  const alignmentFactor = Math.abs(confluence) / 3  // 0..1
  const biasMagnitude = Math.min(m1Std * 0.5, trendStrength * m1Std * (0.5 + 0.5 * alignmentFactor))

  return confluence > 0 ? biasMagnitude : confluence < 0 ? -biasMagnitude : 0
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
  wicks: WickDistribution,  // intra-bar wick ratios for SL/TP piercing
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
  const nWickUp   = wicks.up.length
  const nWickDown = wicks.down.length
  const hasWicks  = nWickUp > 0 && nWickDown > 0

  for (let sim = 0; sim < PATH_COUNT; sim++) {
    let price = startPrice
    let closed = false

    for (let bar = 0; bar < BARS_FORWARD; bar++) {
      // Bootstrap: sample a random historical return
      const r = returns[Math.floor(Math.random() * n)] + bias
      price = price * Math.exp(r)

      // Intra-bar wick modeling: derive simulated high/low from wick distributions
      let simHigh = price
      let simLow  = price
      if (hasWicks) {
        const wickUp   = wicks.up[Math.floor(Math.random() * nWickUp)]
        const wickDown = wicks.down[Math.floor(Math.random() * nWickDown)]
        simHigh = price * (1 + wickUp)
        simLow  = price * (1 - wickDown)
      }

      const hitSL = direction === 'LONG' ? simLow <= slPrice : simHigh >= slPrice
      const hitTP = direction === 'LONG' ? simHigh >= tpPrice : simLow <= tpPrice

      if (hitSL && hitTP) {
        // Both pierced in same bar — resolve by proximity to close
        const slProx = direction === 'LONG'
          ? Math.abs(simLow - slPrice)
          : Math.abs(simHigh - slPrice)
        const tpProx = direction === 'LONG'
          ? Math.abs(simHigh - tpPrice)
          : Math.abs(simLow - tpPrice)
        if (slProx <= tpProx) {
          slHits++
          pnlResults.push(-lossTotal)
        } else {
          tpHits++
          pnlResults.push(profitTotal)
        }
        barsToClose.push(bar + 1)
        closed = true
        break
      }
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

  const bias   = multiTFRegimeBias(returns, inputs.h1, inputs.h4, ema20, ema50)
  const wicks  = wickDistribution(m1)
  const slDist = atr14 * SL_ATR_MULT
  const tpDist = atr14 * TP_ATR_MULT

  const long  = simulateAction('LONG',  returns, currentPrice, slDist, tpDist, pipSize, pipValue, lotSize, bias, wicks)
  const short = simulateAction('SHORT', returns, currentPrice, slDist, tpDist, pipSize, pipValue, lotSize, -bias, wicks)

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
