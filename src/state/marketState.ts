// Wolf-Fin — Market State Classifier
// Converts a FeatureSnapshot into a compact, typed MarketState.
// All downstream modules (detectors, scorer, prompt) share this contract.

import type { FeatureSnapshot, MarketState, MarketRegime } from '../types/market.js'

// ── Regime classification ─────────────────────────────────────────────────────

function classifyRegime(features: FeatureSnapshot): { regime: MarketRegime; reasons: string[] } {
  const { trend, volatility, structure } = features
  const reasons: string[] = []

  // Abnormal volatility → volatile regime
  if (volatility.volatilityRegime === 'abnormal') {
    reasons.push('ATR at abnormal levels (>85th percentile)')
    return { regime: 'volatile', reasons }
  }

  // Very compressed volatility → compressed
  if (volatility.volatilityRegime === 'quiet' && volatility.bbWidthPct < 0.5) {
    reasons.push('Volatility compressed (ATR <25th percentile, tight BB)')
    return { regime: 'compressed', reasons }
  }

  const adxStrong  = trend.adxStrength === 'strong' || trend.adxStrength === 'moderate'
  const adxWeak    = trend.adxStrength === 'weak'
  const emaAligned = trend.emaAlignment !== 'neutral'
  const bosSignal  = structure.bos !== null
  const chochSignal = structure.choch !== null

  // Active trend: ADX moderate+ and EMA aligned in same direction
  if (adxStrong && emaAligned && structure.trendDirection !== 'ranging') {
    reasons.push(`ADX ${trend.adxValue.toFixed(0)} (${trend.adxStrength}), EMA ${trend.emaAlignment}`)
    reasons.push(`Structure: ${structure.trendDirection}`)
    return { regime: 'trend', reasons }
  }

  // CHoCH detected → reversal_watch
  if (chochSignal) {
    reasons.push(`Change of Character (CHoCH): ${structure.choch} — potential reversal`)
    if (volatility.recentRangeExpansion) reasons.push('Range expanding on CHoCH candle')
    return { regime: 'reversal_watch', reasons }
  }

  // BOS without CHoCH + range expansion → breakout_watch
  if (bosSignal && volatility.recentRangeExpansion) {
    reasons.push(`Break of Structure (${structure.bos}) with range expansion`)
    return { regime: 'breakout_watch', reasons }
  }

  // Compressed volatility expanding (squeeze release)
  if (volatility.volatilityPercentile < 35 && volatility.recentRangeExpansion) {
    reasons.push('Volatility squeeze releasing — range expanding from compression')
    return { regime: 'breakout_watch', reasons }
  }

  // ADX weak + no clear trend structure → range
  if (adxWeak && !emaAligned) {
    reasons.push(`ADX ${trend.adxValue.toFixed(0)} (weak) — no directional momentum`)
    reasons.push('EMA convergence — no alignment signal')
    return { regime: 'range', reasons }
  }

  // Default: range
  reasons.push('No dominant regime signal — treating as range')
  return { regime: 'range', reasons }
}

// ── Direction classification ──────────────────────────────────────────────────

function classifyDirection(
  features: FeatureSnapshot,
): { direction: MarketState['direction']; strength: number; reasons: string[] } {
  const { trend } = features
  const reasons: string[] = []

  if (trend.directionBias === 'bullish') {
    reasons.push(`EMA alignment: ${trend.emaAlignment}`)
    if (trend.macdBias === 'bullish') reasons.push('MACD histogram positive')
    if (trend.psarBias === 'bullish') reasons.push('PSAR below price (bullish)')
    if (trend.rsiZone === 'neutral' && trend.rsiValue > 52) reasons.push(`RSI ${trend.rsiValue.toFixed(0)} — bullish momentum zone`)
    if (trend.mtfAlignment === 'aligned_bullish') reasons.push('MTF score aligned bullish')
  } else if (trend.directionBias === 'bearish') {
    reasons.push(`EMA alignment: ${trend.emaAlignment}`)
    if (trend.macdBias === 'bearish') reasons.push('MACD histogram negative')
    if (trend.psarBias === 'bearish') reasons.push('PSAR above price (bearish)')
    if (trend.rsiZone === 'neutral' && trend.rsiValue < 48) reasons.push(`RSI ${trend.rsiValue.toFixed(0)} — bearish momentum zone`)
    if (trend.mtfAlignment === 'aligned_bearish') reasons.push('MTF score aligned bearish')
  } else {
    reasons.push('No strong directional bias — signals mixed or flat')
  }

  return {
    direction: trend.directionBias,
    strength:  trend.directionStrength,
    reasons,
  }
}

// ── Volatility classification ─────────────────────────────────────────────────

function classifyVolatility(
  features: FeatureSnapshot,
): { level: MarketState['volatility']; reasons: string[] } {
  const { volatility } = features
  const reasons: string[] = []

  reasons.push(`ATR at ${volatility.volatilityPercentile}th percentile`)
  if (volatility.recentRangeExpansion) reasons.push('Recent range expanding vs prior bars')
  if (volatility.keltnerPosition === 'above') reasons.push('Price above Keltner upper band')
  if (volatility.keltnerPosition === 'below') reasons.push('Price below Keltner lower band')

  return { level: volatility.volatilityRegime, reasons }
}

// ── Session quality ───────────────────────────────────────────────────────────

function classifySession(
  features: FeatureSnapshot,
): { quality: MarketState['sessionQuality']; reasons: string[] } {
  const { session } = features
  const reasons: string[] = [session.sessionNote]

  if (session.isLondonNYOverlap) reasons.push('London-NY overlap — highest liquidity window')
  else if (session.isOptimalSession) reasons.push('Optimal trading session active')
  else if (session.activeSessions.length === 0) reasons.push('Dead market — outside major sessions')

  return { quality: session.sessionQuality, reasons }
}

// ── Context risk ──────────────────────────────────────────────────────────────

function classifyContextRisk(
  features: FeatureSnapshot,
): { risk: MarketState['contextRisk']; reasons: string[] } {
  const { context, execution } = features
  const reasons: string[] = []
  let riskScore = 0

  if (context.calendarRisk === 'high') {
    riskScore += 3
    reasons.push(`High-impact event in ~${context.nextHighImpactMinutes} minutes`)
  } else if (context.calendarRisk === 'medium') {
    riskScore += 2
    reasons.push(`High-impact event in ~${context.nextHighImpactMinutes} minutes`)
  } else if (context.calendarRisk === 'low') {
    riskScore += 1
    reasons.push('High-impact events within 2 hours')
  }

  if (context.newsRisk === 'elevated') {
    riskScore += 1
    reasons.push(`${context.newsCount} news item(s) with sentiment impact`)
  }

  if (execution.spreadStatus === 'abnormal') {
    riskScore += 2
    reasons.push(`Spread abnormal: ${execution.spreadPips} pips`)
  } else if (execution.spreadStatus === 'wide') {
    riskScore += 1
    reasons.push(`Spread wide: ${execution.spreadPips} pips`)
  }

  const risk: MarketState['contextRisk'] =
    riskScore >= 4 ? 'avoid'
    : riskScore >= 3 ? 'elevated'
    : riskScore >= 1 ? 'moderate'
    : 'low'

  if (riskScore === 0) reasons.push('No elevated context risks')

  return { risk, reasons }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function classifyMarketState(features: FeatureSnapshot): MarketState {
  const now = new Date().toISOString()

  const { regime, reasons: regimeReasons }       = classifyRegime(features)
  const { direction, strength, reasons: dirReasons } = classifyDirection(features)
  const { level: volatility, reasons: volReasons }   = classifyVolatility(features)
  const { quality: sessionQuality, reasons: sesReasons } = classifySession(features)
  const { risk: contextRisk, reasons: riskReasons }   = classifyContextRisk(features)

  return {
    symbolKey:        features.symbolKey,
    capturedAt:       now,
    regime,
    direction,
    directionStrength: strength,
    volatility,
    sessionQuality,
    contextRisk,
    regimeReasons,
    directionReasons:  dirReasons,
    volatilityReasons: volReasons,
    sessionReasons:    sesReasons,
    riskReasons,
  }
}
