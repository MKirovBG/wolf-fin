// Wolf-Fin — Range Fade / Mean Reversion Detector
// Looks for extreme range tags with low breakout quality and favorable mean-reversion context.

import type { DetectorInput } from './interface.js'
import type { SetupCandidate } from '../types/setup.js'
import { emptyCandidate, zeroBreakdown, computeRR } from './interface.js'

const KEY = 'range_fade'
const LABEL = 'Range Fade / Mean Reversion'

export function detectRangeFade(input: DetectorInput): SetupCandidate {
  const { features, marketState, indicators, candles } = input
  const { trend, structure, volatility, levels, context, execution, session } = features
  const atr = volatility.atrAbsolute
  const price = candles[candles.length - 1].close

  // ── Hard disqualifiers ─────────────────────────────────────────────────────
  const disq: string[] = []
  if (execution.spreadStatus === 'abnormal') disq.push('Spread abnormal')
  if (context.calendarRisk === 'high')       disq.push('High-impact news imminent')
  if (marketState.contextRisk === 'avoid')   disq.push('Context risk: avoid')
  if (disq.length) return emptyCandidate(features.symbolKey, KEY, LABEL, [], disq)

  // ── Preconditions ──────────────────────────────────────────────────────────
  if (marketState.regime !== 'range' && marketState.regime !== 'compressed') {
    return emptyCandidate(features.symbolKey, KEY, LABEL, [`Regime ${marketState.regime} — range fade not valid`])
  }
  if (volatility.volatilityRegime === 'abnormal') {
    return emptyCandidate(features.symbolKey, KEY, LABEL, ['Abnormal volatility — range undefined'])
  }

  // Price must be near the range boundary (within 0.4 ATR of swing high/low)
  const distToHigh = Math.abs(price - structure.recentSwingHigh)
  const distToLow  = Math.abs(price - structure.recentSwingLow)
  const atHigh = distToHigh < atr * 0.4
  const atLow  = distToLow  < atr * 0.4

  if (!atHigh && !atLow) {
    return emptyCandidate(features.symbolKey, KEY, LABEL, ['Price not at range boundary'])
  }

  // Confirm no momentum continuation (ADX weak, no BOS)
  if (trend.adxStrength === 'strong') {
    return emptyCandidate(features.symbolKey, KEY, LABEL, ['ADX strong — potential breakout, not fade'])
  }
  if (structure.bos !== null) {
    return emptyCandidate(features.symbolKey, KEY, LABEL, ['BOS detected — range may be breaking out'])
  }

  // RSI extreme for the boundary side
  const isBull = atLow  // fade from range low → buy
  const expectedRsiZone = isBull ? 'oversold' : 'overbought'
  if (trend.rsiZone !== expectedRsiZone && trend.rsiValue > 35 && trend.rsiValue < 65) {
    return emptyCandidate(features.symbolKey, KEY, LABEL, ['RSI not confirming extreme — fade not yet ready'])
  }

  // ── Geometry ───────────────────────────────────────────────────────────────
  const direction = isBull ? 'BUY' : 'SELL'
  const boundary  = isBull ? structure.recentSwingLow : structure.recentSwingHigh
  const midPoint  = (structure.recentSwingHigh + structure.recentSwingLow) / 2

  const entryZone = {
    low:  +(price - atr * 0.2).toFixed(input.digits),
    high: +(price + atr * 0.2).toFixed(input.digits),
  }
  const stopLoss = isBull
    ? +(boundary - atr * 0.5).toFixed(input.digits)
    : +(boundary + atr * 0.5).toFixed(input.digits)

  const stopDist = Math.abs(price - stopLoss)
  const tp1 = isBull
    ? +(midPoint).toFixed(input.digits)  // range midpoint / VWAP as first target
    : +(midPoint).toFixed(input.digits)
  const tp2 = isBull
    ? +(price + stopDist * 2.5).toFixed(input.digits)
    : +(price - stopDist * 2.5).toFixed(input.digits)

  const reasons: string[] = [
    `Range regime — price at ${isBull ? 'support' : 'resistance'} boundary`,
    `RSI ${trend.rsiValue.toFixed(0)} (${trend.rsiZone}) — ${isBull ? 'oversold' : 'overbought'} extreme`,
    `ADX ${trend.adxValue.toFixed(0)} (weak) — no breakout momentum`,
  ]
  if (levels.vwapSide) reasons.push(`VWAP ${levels.vwapSide} — target toward midpoint`)
  if (indicators.divergence?.rsi) reasons.push(`RSI divergence: ${indicators.divergence.rsi}`)

  const tags = ['range_fade', isBull ? 'support_bounce' : 'resistance_rejection', marketState.regime]

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
      ? `Close below ${stopLoss.toFixed(input.digits)} — range support broken`
      : `Close above ${stopLoss.toFixed(input.digits)} — range resistance broken`,
    score: 0,
    tier: 'rejected',
    scoreBreakdown: zeroBreakdown(),
    reasons,
    disqualifiers: [],
    tags,
  }
}
