// Wolf-Fin — Monte Carlo Layer 1: Markov Chain Regime State Machine
//
// Classifies the current market regime (TRENDING_UP, TRENDING_DOWN, RANGING,
// VOLATILE) by analysing recent candle returns and ATR, then builds a simple
// empirical transition matrix from the last N bars.  The output provides:
//   • regimeBias     → shifts the mean of the MC return distribution
//   • volatilityScalar → scales the MC return std-dev
//
// No external dependencies — only the M1 candles already fetched by the agent.

import type { Candle } from './types.js'
import type { MarkovResult, MarkovState } from './mc-types.js'

// ── Hyper-parameters ──────────────────────────────────────────────────────────

const LOOKBACK      = 60   // candles used to build the transition matrix
const ATR_PERIOD    = 14   // period for ATR calculation (regime volatility)
const TREND_SLOPE   = 14   // EMA slope period for trend direction

// ── Helpers ───────────────────────────────────────────────────────────────────

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const result: number[] = []
  let prev = values[0]
  for (const v of values) {
    const e = v * k + prev * (1 - k)
    result.push(e)
    prev = e
  }
  return result
}

function atr(candles: Candle[], period: number): number {
  if (candles.length < 2) return 0
  const trs: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high
    const l = candles[i].low
    const pc = candles[i - 1].close
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)))
  }
  // Simple mean over last `period` true ranges
  const window = trs.slice(-period)
  return window.reduce((s, v) => s + v, 0) / window.length
}

function classifyState(
  candle: Candle,
  prevCandle: Candle,
  currentAtr: number,
  emaValues: number[],
  idx: number,
  slopeWindow: number,
): MarkovState {
  const ret = (candle.close - prevCandle.close) / prevCandle.close
  const bodySize = Math.abs(candle.close - candle.open)
  const range = candle.high - candle.low || 1e-9

  // High volatility: candle range > 2× ATR
  if (range > 2 * currentAtr) return 'VOLATILE'

  // Trending: EMA slope over slopeWindow bars
  if (idx >= slopeWindow) {
    const slope = (emaValues[idx] - emaValues[idx - slopeWindow]) / emaValues[idx - slopeWindow]
    if (slope > 0.0005) return 'TRENDING_UP'
    if (slope < -0.0005) return 'TRENDING_DOWN'
  }

  return 'RANGING'
}

// ── Main export ───────────────────────────────────────────────────────────────

export function runMarkov(m1: Candle[]): MarkovResult {
  const states: MarkovState[] = ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING', 'VOLATILE']

  if (m1.length < LOOKBACK + TREND_SLOPE + 2) {
    // Not enough data — return neutral defaults
    return {
      currentState:   'RANGING',
      nextStateProbs: { TRENDING_UP: 0.25, TRENDING_DOWN: 0.25, RANGING: 0.25, VOLATILE: 0.25 },
      regimeBias:     0,
      volatilityScalar: 1,
      stateHistory:   [],
    }
  }

  const candles = m1.slice(-(LOOKBACK + TREND_SLOPE + 2))
  const closes  = candles.map(c => c.close)
  const emas    = ema(closes, TREND_SLOPE)
  const currentAtr = atr(candles.slice(-ATR_PERIOD - 1), ATR_PERIOD)

  // Build state history
  const stateHistory: MarkovState[] = []
  for (let i = 1; i < candles.length; i++) {
    stateHistory.push(classifyState(candles[i], candles[i - 1], currentAtr, emas, i, TREND_SLOPE))
  }

  const currentState = stateHistory[stateHistory.length - 1]

  // Build transition matrix from last LOOKBACK states
  const window = stateHistory.slice(-LOOKBACK)
  const counts: Record<MarkovState, Record<MarkovState, number>> = {
    TRENDING_UP:   { TRENDING_UP: 0, TRENDING_DOWN: 0, RANGING: 0, VOLATILE: 0 },
    TRENDING_DOWN: { TRENDING_UP: 0, TRENDING_DOWN: 0, RANGING: 0, VOLATILE: 0 },
    RANGING:       { TRENDING_UP: 0, TRENDING_DOWN: 0, RANGING: 0, VOLATILE: 0 },
    VOLATILE:      { TRENDING_UP: 0, TRENDING_DOWN: 0, RANGING: 0, VOLATILE: 0 },
  }
  for (let i = 0; i < window.length - 1; i++) {
    counts[window[i]][window[i + 1]]++
  }

  // Normalise row for currentState → next state probabilities
  const row = counts[currentState]
  const total = states.reduce((s, st) => s + row[st], 0) || 1
  const nextStateProbs = {
    TRENDING_UP:   row.TRENDING_UP   / total,
    TRENDING_DOWN: row.TRENDING_DOWN / total,
    RANGING:       row.RANGING       / total,
    VOLATILE:      row.VOLATILE      / total,
  }

  // Regime bias: net bullish / bearish signal for MC path generation
  const regimeBias = (() => {
    switch (currentState) {
      case 'TRENDING_UP':   return 0.3 + (nextStateProbs.TRENDING_UP - nextStateProbs.TRENDING_DOWN) * 0.4
      case 'TRENDING_DOWN': return -0.3 + (nextStateProbs.TRENDING_DOWN - nextStateProbs.TRENDING_UP) * 0.4
      case 'VOLATILE':      return (nextStateProbs.TRENDING_UP - nextStateProbs.TRENDING_DOWN) * 0.2
      default:              return 0   // RANGING
    }
  })()

  // Volatility scalar: scale the MC return std-dev up in volatile regimes
  const volatilityScalar = (() => {
    switch (currentState) {
      case 'VOLATILE':      return 1.8
      case 'TRENDING_UP':
      case 'TRENDING_DOWN': return 1.1
      default:              return 0.9   // RANGING
    }
  })()

  return {
    currentState,
    nextStateProbs,
    regimeBias,
    volatilityScalar,
    stateHistory: stateHistory.slice(-20),   // last 20 for the UI sparkline
  }
}
