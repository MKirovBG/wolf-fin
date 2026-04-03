// Wolf-Fin — Breakout and Retest Detector
// Identifies a clean breakout from structure followed by a retest of the broken level.

import type { DetectorInput } from './interface.js'
import type { SetupCandidate } from '../types/setup.js'
import { emptyCandidate, zeroBreakdown, computeRR } from './interface.js'

const KEY = 'breakout_retest'
const LABEL = 'Breakout and Retest'

export function detectBreakoutRetest(input: DetectorInput): SetupCandidate {
  const { features, marketState, candles } = input
  const { trend, structure, volatility, context, execution, session } = features
  const atr = volatility.atrAbsolute
  const price = candles[candles.length - 1].close

  // ── Hard disqualifiers ─────────────────────────────────────────────────────
  const disq: string[] = []
  if (execution.spreadStatus === 'abnormal') disq.push('Spread abnormal')
  if (context.calendarRisk === 'high')       disq.push('High-impact news imminent')
  if (volatility.volatilityRegime === 'abnormal') disq.push('Abnormal volatility')
  if (marketState.contextRisk === 'avoid')   disq.push('Context risk: avoid')
  if (disq.length) return emptyCandidate(features.symbolKey, KEY, LABEL, [], disq)

  // ── Preconditions: BOS must exist ─────────────────────────────────────────
  if (!structure.bos) {
    return emptyCandidate(features.symbolKey, KEY, LABEL, ['No break of structure detected'])
  }
  if (marketState.regime !== 'breakout_watch' && marketState.regime !== 'trend') {
    return emptyCandidate(features.symbolKey, KEY, LABEL, [`Regime ${marketState.regime} — breakout not valid`])
  }

  const isBull = structure.bos === 'bullish'
  const direction = isBull ? 'BUY' : 'SELL'

  // Retest check: price must have returned to near the broken level after the BOS
  const brokenLevel = isBull ? structure.recentSwingHigh : structure.recentSwingLow
  const distToLevel = Math.abs(price - brokenLevel)
  const retestZone = atr * 0.5  // within 0.5 ATR of the broken level = retest

  if (distToLevel > retestZone) {
    return emptyCandidate(features.symbolKey, KEY, LABEL,
      [`Price ${(distToLevel / atr).toFixed(1)} ATR from broken level — not retesting yet`])
  }

  // Confirm price is on the right side (BOS bullish = price above broken high now retesting it)
  const onCorrectSide = isBull ? price >= brokenLevel - retestZone * 0.5 : price <= brokenLevel + retestZone * 0.5
  if (!onCorrectSide) {
    return emptyCandidate(features.symbolKey, KEY, LABEL, ['Price wrong side of broken level'])
  }

  // ── Geometry ───────────────────────────────────────────────────────────────
  const entryZone = {
    low:  +(brokenLevel - atr * 0.2).toFixed(input.digits),
    high: +(brokenLevel + atr * 0.2).toFixed(input.digits),
  }
  const stopLoss = isBull
    ? +(brokenLevel - atr * 1.1).toFixed(input.digits)
    : +(brokenLevel + atr * 1.1).toFixed(input.digits)

  const stopDist = Math.abs(price - stopLoss)
  const tp1 = isBull
    ? +(price + stopDist * 2).toFixed(input.digits)
    : +(price - stopDist * 2).toFixed(input.digits)
  const tp2 = isBull
    ? +(price + stopDist * 3.5).toFixed(input.digits)
    : +(price - stopDist * 3.5).toFixed(input.digits)

  const reasons: string[] = [
    `BOS ${structure.bos.toUpperCase()} — price broke ${isBull ? 'swing high' : 'swing low'}`,
    `Retesting broken level at ${brokenLevel.toFixed(input.digits)}`,
    `Distance from level: ${distToLevel.toFixed(input.digits)} (within ${retestZone.toFixed(input.digits)} retest zone)`,
  ]
  if (volatility.recentRangeExpansion) reasons.push('Range expansion on breakout bar')
  if (trend.macdBias === (isBull ? 'bullish' : 'bearish')) reasons.push('MACD confirming direction')

  const tags = [
    structure.bos,
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
      ? `Close below ${stopLoss.toFixed(input.digits)}`
      : `Close above ${stopLoss.toFixed(input.digits)}`,
    score: 0,
    tier: 'rejected',
    scoreBreakdown: zeroBreakdown(),
    reasons,
    disqualifiers: [],
    tags,
  }
}
