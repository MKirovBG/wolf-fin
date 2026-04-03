// Wolf-Fin — Liquidity Sweep Reversal Detector
// Identifies a sweep of a prior high/low followed by a strong rejection and reclaim.

import type { DetectorInput } from './interface.js'
import type { SetupCandidate } from '../types/setup.js'
import { emptyCandidate, zeroBreakdown, computeRR } from './interface.js'

const KEY = 'liquidity_sweep'
const LABEL = 'Liquidity Sweep Reversal'

export function detectLiquiditySweep(input: DetectorInput): SetupCandidate {
  const { features, marketState, candles } = input
  const { structure, volatility, context, execution, session } = features
  const atr = volatility.atrAbsolute
  const n = candles.length
  if (n < 5) return emptyCandidate(features.symbolKey, KEY, LABEL, ['Insufficient candles'])

  const price  = candles[n - 1].close
  const lastC  = candles[n - 1]
  const prevC  = candles[n - 2]

  // ── Hard disqualifiers ─────────────────────────────────────────────────────
  const disq: string[] = []
  if (execution.spreadStatus === 'abnormal') disq.push('Spread abnormal')
  if (context.calendarRisk === 'high')       disq.push('High-impact news imminent')
  if (marketState.contextRisk === 'avoid')   disq.push('Context risk: avoid')
  if (disq.length) return emptyCandidate(features.symbolKey, KEY, LABEL, [], disq)

  // ── Detect sweep: last candle's wick extends beyond swing, then closes back ──
  // Bullish sweep reversal: wick below recent swing low, close back above it
  // Bearish sweep reversal: wick above recent swing high, close back below it

  const swingHigh = structure.recentSwingHigh
  const swingLow  = structure.recentSwingLow

  const wickBelowSwingLow  = lastC.low < swingLow - atr * 0.05 && lastC.close > swingLow
  const wickAboveSwingHigh = lastC.high > swingHigh + atr * 0.05 && lastC.close < swingHigh

  // Also check if the prior candle swept (2-bar sweep pattern)
  const prevWickBelowLow   = prevC.low < swingLow - atr * 0.05 && lastC.close > swingLow
  const prevWickAboveHigh  = prevC.high > swingHigh + atr * 0.05 && lastC.close < swingHigh

  const isBullSweep = wickBelowSwingLow || prevWickBelowLow
  const isBearSweep = wickAboveSwingHigh || prevWickAboveHigh

  if (!isBullSweep && !isBearSweep) {
    return emptyCandidate(features.symbolKey, KEY, LABEL, ['No liquidity sweep detected on recent candles'])
  }

  // ── Geometry ───────────────────────────────────────────────────────────────
  const isBull  = isBullSweep
  const direction = isBull ? 'BUY' : 'SELL'
  const sweepExtreme = isBull
    ? Math.min(lastC.low, prevC.low)
    : Math.max(lastC.high, prevC.high)

  const entryZone = {
    low:  +(price - atr * 0.2).toFixed(input.digits),
    high: +(price + atr * 0.2).toFixed(input.digits),
  }
  const stopLoss = isBull
    ? +(sweepExtreme - atr * 0.3).toFixed(input.digits)
    : +(sweepExtreme + atr * 0.3).toFixed(input.digits)

  const stopDist = Math.abs(price - stopLoss)
  const tp1 = isBull
    ? +(price + stopDist * 2).toFixed(input.digits)
    : +(price - stopDist * 2).toFixed(input.digits)
  const tp2 = isBull
    ? +(price + stopDist * 3).toFixed(input.digits)
    : +(price - stopDist * 3).toFixed(input.digits)

  const sweepSize = Math.abs(sweepExtreme - (isBull ? swingLow : swingHigh))

  const reasons: string[] = [
    `${isBull ? 'Bullish' : 'Bearish'} liquidity sweep — wick ${isBull ? 'below' : 'above'} swing ${isBull ? 'low' : 'high'}`,
    `Swept ${sweepSize.toFixed(input.digits)} beyond swing level, closed back inside`,
    `Strong rejection candle — reclaim confirmed`,
  ]
  if (structure.choch === (isBull ? 'bullish' : 'bearish')) {
    reasons.push('CHoCH aligns — structural reversal signal')
  }

  const tags = [
    isBull ? 'sweep_low' : 'sweep_high',
    session.activeSessions[0] ?? 'off-session',
    marketState.regime,
  ]

  return {
    symbolKey: features.symbolKey,
    capturedAt: new Date().toISOString(),
    detector: KEY,
    found: true,
    setupType: LABEL,
    direction,
    entryZone,
    stopLoss,
    targets: [tp1, tp2],
    riskReward: computeRR(price, stopLoss, tp1),
    invalidationRule: isBull
      ? `Close below ${sweepExtreme.toFixed(input.digits)}`
      : `Close above ${sweepExtreme.toFixed(input.digits)}`,
    score: 0,
    tier: 'rejected',
    scoreBreakdown: zeroBreakdown(),
    reasons,
    disqualifiers: [],
    tags,
  }
}
