// Wolf-Fin — Session Reversal Detector
// Targets late-session exhaustion or reversal after an extended trend leg.

import type { DetectorInput } from './interface.js'
import type { SetupCandidate } from '../types/setup.js'
import { emptyCandidate, zeroBreakdown, computeRR } from './interface.js'

const KEY = 'session_reversal'
const LABEL = 'Session Reversal'

export function detectSessionReversal(input: DetectorInput): SetupCandidate {
  const { features, marketState, indicators, candles } = input
  const { trend, structure, volatility, context, execution, session } = features
  const atr = volatility.atrAbsolute
  const price = candles[candles.length - 1].close

  // ── Hard disqualifiers ─────────────────────────────────────────────────────
  const disq: string[] = []
  if (execution.spreadStatus === 'abnormal') disq.push('Spread abnormal')
  if (context.calendarRisk === 'high')       disq.push('High-impact news imminent')
  if (marketState.contextRisk === 'avoid')   disq.push('Context risk: avoid')
  if (disq.length) return emptyCandidate(features.symbolKey, KEY, LABEL, [], disq)

  // ── Preconditions ──────────────────────────────────────────────────────────
  // Must be in an active session
  if (!session.isOptimalSession && session.activeSessions.length === 0) {
    return emptyCandidate(features.symbolKey, KEY, LABEL, ['No active session for session reversal'])
  }

  // Requires overextension: price moved 2+ ATR from recent swing
  if (structure.overextensionATR < 2.0) {
    return emptyCandidate(features.symbolKey, KEY, LABEL,
      [`Overextension ${structure.overextensionATR.toFixed(1)} ATR — need ≥ 2.0 for reversal setup`])
  }

  // Momentum should be weakening: RSI extreme + divergence signal
  const hasExtremeRsi = trend.rsiZone !== 'neutral'
  const hasDivergence  = !!(indicators.divergence?.rsi || indicators.divergence?.macd)

  if (!hasExtremeRsi && !hasDivergence) {
    return emptyCandidate(features.symbolKey, KEY, LABEL, ['No momentum exhaustion signal (RSI extreme or divergence required)'])
  }

  // CHoCH is a strong confirmation
  const hasChoch = structure.choch !== null

  // Direction: reverse the current trend direction
  const isOverextendedBull = trend.directionBias === 'bullish' && trend.rsiZone === 'overbought'
  const isOverextendedBear = trend.directionBias === 'bearish' && trend.rsiZone === 'oversold'

  if (!isOverextendedBull && !isOverextendedBear && !hasChoch) {
    return emptyCandidate(features.symbolKey, KEY, LABEL, ['No clear exhaustion signal for session reversal'])
  }

  const isSellReversal = isOverextendedBull || (hasChoch && structure.choch === 'bearish')
  const direction = isSellReversal ? 'SELL' : 'BUY'

  // ── Geometry ───────────────────────────────────────────────────────────────
  const extreme = isSellReversal ? structure.recentSwingHigh : structure.recentSwingLow

  const entryZone = {
    low:  +(price - atr * 0.2).toFixed(input.digits),
    high: +(price + atr * 0.2).toFixed(input.digits),
  }
  const stopLoss = isSellReversal
    ? +(extreme + atr * 0.4).toFixed(input.digits)
    : +(extreme - atr * 0.4).toFixed(input.digits)

  const stopDist = Math.abs(price - stopLoss)
  const tp1 = isSellReversal
    ? +(price - stopDist * 2).toFixed(input.digits)
    : +(price + stopDist * 2).toFixed(input.digits)
  const tp2 = isSellReversal
    ? +(price - stopDist * 3).toFixed(input.digits)
    : +(price + stopDist * 3).toFixed(input.digits)

  const reasons: string[] = [
    `Overextension: ${structure.overextensionATR.toFixed(1)} ATR from ${isSellReversal ? 'swing high' : 'swing low'}`,
    `RSI ${trend.rsiValue.toFixed(0)} (${trend.rsiZone}) — ${isSellReversal ? 'overbought' : 'oversold'} extreme`,
    `Session: ${session.sessionNote}`,
  ]
  if (hasDivergence) {
    if (indicators.divergence?.rsi)  reasons.push(`RSI divergence: ${indicators.divergence.rsi}`)
    if (indicators.divergence?.macd) reasons.push(`MACD divergence: ${indicators.divergence.macd}`)
  }
  if (hasChoch) reasons.push(`CHoCH ${structure.choch} — structural confirmation`)

  const tags = [
    'session_reversal',
    isSellReversal ? 'exhaustion_sell' : 'exhaustion_buy',
    session.activeSessions[0] ?? 'session',
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
    invalidationRule: isSellReversal
      ? `New high above ${stopLoss.toFixed(input.digits)}`
      : `New low below ${stopLoss.toFixed(input.digits)}`,
    score: 0,
    tier: 'rejected',
    scoreBreakdown: zeroBreakdown(),
    reasons,
    disqualifiers: [],
    tags,
  }
}
