// Wolf-Fin — Opening Range Breakout Detector
// Uses the first N bars of a session as the opening range and monitors for breakout.

import type { DetectorInput } from './interface.js'
import type { SetupCandidate } from '../types/setup.js'
import { emptyCandidate, zeroBreakdown, computeRR } from './interface.js'

const KEY = 'opening_range'
const LABEL = 'Opening Range Breakout'

// Opening range is defined as the first N bars of a session
const ORB_BARS = 4  // first 4 H1 bars = 4-hour range

export function detectOpeningRange(input: DetectorInput): SetupCandidate {
  const { features, marketState, candles } = input
  const { session, volatility, context, execution } = features
  const atr = volatility.atrAbsolute
  const n = candles.length
  if (n < ORB_BARS + 2) return emptyCandidate(features.symbolKey, KEY, LABEL, ['Insufficient candles for ORB'])

  // ── Hard disqualifiers ─────────────────────────────────────────────────────
  const disq: string[] = []
  if (execution.spreadStatus === 'abnormal') disq.push('Spread abnormal')
  if (context.calendarRisk === 'high')       disq.push('High-impact news imminent')
  if (marketState.contextRisk === 'avoid')   disq.push('Context risk: avoid')
  if (disq.length) return emptyCandidate(features.symbolKey, KEY, LABEL, [], disq)

  // Only valid during or right after active session
  if (!session.isOptimalSession && !session.isLondonNYOverlap) {
    return emptyCandidate(features.symbolKey, KEY, LABEL, ['Outside optimal session window for ORB'])
  }

  // ── Define opening range from last ORB_BARS candles before current ─────────
  const orbSlice = candles.slice(-(ORB_BARS + 1), -1)  // exclude current
  const orbHigh  = Math.max(...orbSlice.map(c => c.high))
  const orbLow   = Math.min(...orbSlice.map(c => c.low))
  const orbRange = orbHigh - orbLow

  // Range must be meaningful (0.3–2.5 ATR)
  if (orbRange < atr * 0.3 || orbRange > atr * 2.5) {
    return emptyCandidate(features.symbolKey, KEY, LABEL,
      [`ORB range ${(orbRange / atr).toFixed(2)} ATR — outside 0.3–2.5 ATR window`])
  }

  const price   = candles[n - 1].close
  const lastBar = candles[n - 1]

  // ── Breakout detection: close outside the ORB ────────────────────────────
  const bullBreak = lastBar.close > orbHigh && lastBar.close > lastBar.open  // bullish close above
  const bearBreak = lastBar.close < orbLow  && lastBar.close < lastBar.open  // bearish close below

  if (!bullBreak && !bearBreak) {
    return emptyCandidate(features.symbolKey, KEY, LABEL,
      ['Price has not broken out of the opening range yet'])
  }

  const isBull = bullBreak
  const direction = isBull ? 'BUY' : 'SELL'

  // ── Geometry ───────────────────────────────────────────────────────────────
  const breakLevel = isBull ? orbHigh : orbLow
  const entryZone  = {
    low:  +(breakLevel - atr * 0.1).toFixed(input.digits),
    high: +(breakLevel + atr * 0.3).toFixed(input.digits),
  }
  const stopLoss = isBull
    ? +(breakLevel - atr * 0.5).toFixed(input.digits)
    : +(breakLevel + atr * 0.5).toFixed(input.digits)

  const tp1 = isBull
    ? +(breakLevel + orbRange).toFixed(input.digits)       // 1× range projected
    : +(breakLevel - orbRange).toFixed(input.digits)
  const tp2 = isBull
    ? +(breakLevel + orbRange * 1.8).toFixed(input.digits) // 1.8× range
    : +(breakLevel - orbRange * 1.8).toFixed(input.digits)

  const reasons: string[] = [
    `Opening range defined: ${orbLow.toFixed(input.digits)} – ${orbHigh.toFixed(input.digits)} (${(orbRange / atr).toFixed(2)} ATR)`,
    `${isBull ? 'Bullish' : 'Bearish'} close outside ORB — breakout confirmed`,
    `Session: ${session.sessionNote}`,
  ]

  const tags = [
    'orb',
    session.activeSessions[0] ?? 'session',
    isBull ? 'bull_break' : 'bear_break',
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
      ? `Close back inside opening range (below ${orbHigh.toFixed(input.digits)})`
      : `Close back inside opening range (above ${orbLow.toFixed(input.digits)})`,
    score: 0,
    tier: 'rejected',
    scoreBreakdown: zeroBreakdown(),
    reasons,
    disqualifiers: [],
    tags,
  }
}
