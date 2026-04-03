// Wolf-Fin — Scoring engine with full score decomposition (Phase 2)

import type { SetupCandidate, ScoreBreakdown } from '../types/setup.js'
import type { FeatureSnapshot, MarketState } from '../types/market.js'
import type { StrategyDefinition } from '../types/strategy.js'
import { WEIGHTS, scoreTier } from './weights.js'
import { checkHardDisqualifiers } from './guardrails.js'

// ── Component scorers ─────────────────────────────────────────────────────────

function scoreTrendAlignment(
  candidate: SetupCandidate,
  features: FeatureSnapshot,
  marketState: MarketState,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let s = 0
  const dir = candidate.direction
  const { trend, structure } = features

  // EMA alignment matches trade direction
  if ((dir === 'BUY' && trend.emaAlignment === 'bullish') ||
      (dir === 'SELL' && trend.emaAlignment === 'bearish')) {
    s += 6; reasons.push('EMA aligned with trade direction')
  } else if (trend.emaAlignment === 'neutral') {
    s += 2; reasons.push('EMA neutral — partial credit')
  }

  // MTF alignment
  if ((dir === 'BUY' && trend.mtfAlignment === 'aligned_bullish') ||
      (dir === 'SELL' && trend.mtfAlignment === 'aligned_bearish')) {
    s += 5; reasons.push('MTF score fully aligned')
  } else if (trend.mtfAlignment === 'divergent') {
    s += 1; reasons.push('MTF partially aligned')
  }

  // ADX strength
  if (trend.adxStrength === 'strong')   { s += 4; reasons.push('ADX strong — trend conviction') }
  else if (trend.adxStrength === 'moderate') { s += 2; reasons.push('ADX moderate') }

  return { score: Math.min(s, WEIGHTS.trendAlignment), reasons }
}

function scoreStructureQuality(
  candidate: SetupCandidate,
  features: FeatureSnapshot,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let s = 0
  const dir = candidate.direction
  const { structure } = features

  // Trend direction matches trade
  if ((dir === 'BUY' && structure.trendDirection === 'uptrend') ||
      (dir === 'SELL' && structure.trendDirection === 'downtrend')) {
    s += 6; reasons.push(`Structure: ${structure.trendDirection}`)
  } else if (structure.trendDirection === 'ranging') {
    s += 2; reasons.push('Structure: ranging')
  }

  // BOS in trade direction
  if ((dir === 'BUY' && structure.bos === 'bullish') ||
      (dir === 'SELL' && structure.bos === 'bearish')) {
    s += 5; reasons.push('BOS in trade direction')
  }

  // CHoCH confirms reversal potential (only good for reversal-type detectors)
  if ((dir === 'BUY' && structure.choch === 'bullish') ||
      (dir === 'SELL' && structure.choch === 'bearish')) {
    s += 4; reasons.push('CHoCH structural confirmation')
  }

  return { score: Math.min(s, WEIGHTS.structureQuality), reasons }
}

function scoreEntryPrecision(
  candidate: SetupCandidate,
  features: FeatureSnapshot,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let s = 0
  if (!candidate.entryZone) return { score: 0, reasons: ['No entry zone defined'] }

  const { trend, levels } = features
  const atr = features.volatility.atrAbsolute
  const entryWidth = candidate.entryZone.high - candidate.entryZone.low

  // Tight entry zone relative to ATR
  if (atr > 0) {
    const widthRatio = entryWidth / atr
    if (widthRatio < 0.3) { s += 5; reasons.push('Tight entry zone (<0.3 ATR wide)') }
    else if (widthRatio < 0.6) { s += 3; reasons.push('Moderate entry zone (0.3–0.6 ATR)') }
    else { s += 1; reasons.push('Wide entry zone — less precise') }
  }

  // Near Fibonacci level
  if (levels.nearestFibLabel) { s += 3; reasons.push(`Entry near Fibonacci ${levels.nearestFibLabel}`) }

  // Near VWAP
  if (levels.vwapDistance < 0.1) { s += 2; reasons.push('Entry near VWAP — fair value zone') }

  return { score: Math.min(s, WEIGHTS.entryPrecision), reasons }
}

function scoreStopQuality(
  candidate: SetupCandidate,
  features: FeatureSnapshot,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let s = 0
  if (candidate.stopLoss === null || !candidate.entryZone) return { score: 0, reasons: ['No stop defined'] }

  const atr = features.volatility.atrAbsolute
  const entryMid = (candidate.entryZone.low + candidate.entryZone.high) / 2
  const stopDist = Math.abs(entryMid - candidate.stopLoss)

  if (atr > 0) {
    const atrRatio = stopDist / atr
    if (atrRatio >= 0.8 && atrRatio <= 1.5) {
      s += 7; reasons.push(`Stop at ${atrRatio.toFixed(2)} ATR — well-placed`)
    } else if (atrRatio >= 0.5 && atrRatio < 0.8) {
      s += 4; reasons.push(`Stop at ${atrRatio.toFixed(2)} ATR — tight but valid`)
    } else if (atrRatio > 1.5 && atrRatio <= 2.5) {
      s += 3; reasons.push(`Stop at ${atrRatio.toFixed(2)} ATR — wide`)
    } else {
      s += 1; reasons.push(`Stop at ${atrRatio.toFixed(2)} ATR — outside normal range`)
    }
  }

  // Behind structure
  const { structure } = features
  const isBuy = candidate.direction === 'BUY'
  const stopBehindSwing = isBuy
    ? candidate.stopLoss < structure.recentSwingLow
    : candidate.stopLoss > structure.recentSwingHigh
  if (stopBehindSwing) { s += 3; reasons.push('Stop behind swing structure') }

  return { score: Math.min(s, WEIGHTS.stopQuality), reasons }
}

function scoreTargetQuality(
  candidate: SetupCandidate,
  features: FeatureSnapshot,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let s = 0

  if (candidate.targets.length === 0 || candidate.stopLoss === null || !candidate.entryZone) {
    return { score: 0, reasons: ['No targets defined'] }
  }

  const rr = candidate.riskReward
  if (rr >= 3)      { s += 7; reasons.push(`R:R ${rr.toFixed(1)} — excellent`) }
  else if (rr >= 2) { s += 5; reasons.push(`R:R ${rr.toFixed(1)} — good`) }
  else if (rr >= 1.5) { s += 3; reasons.push(`R:R ${rr.toFixed(1)} — acceptable`) }
  else              { s += 1; reasons.push(`R:R ${rr.toFixed(1)} — low`) }

  if (candidate.targets.length >= 2) { s += 2; reasons.push('Multiple targets defined') }
  if (candidate.invalidationRule)    { s += 1; reasons.push('Invalidation rule defined') }

  return { score: Math.min(s, WEIGHTS.targetQuality), reasons }
}

function scoreSessionTiming(
  candidate: SetupCandidate,
  features: FeatureSnapshot,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let s = 0
  const { session } = features

  if (session.sessionQuality === 'optimal')    { s = 10; reasons.push('London-NY overlap — peak liquidity') }
  else if (session.sessionQuality === 'favorable') { s = 7;  reasons.push(`${session.activeSessions.join('+')} session`) }
  else if (session.sessionQuality === 'acceptable') { s = 4; reasons.push('Active session but not peak') }
  else { s = 1; reasons.push('Off-session — low liquidity') }

  return { score: s, reasons }
}

function scoreVolatilitySuitability(
  candidate: SetupCandidate,
  features: FeatureSnapshot,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let s = 0
  const { volatility } = features

  if (volatility.volatilityRegime === 'normal') {
    s = 9; reasons.push('Normal volatility — optimal for execution')
  } else if (volatility.volatilityRegime === 'elevated') {
    s = 6; reasons.push('Elevated volatility — wider stops may be needed')
  } else if (volatility.volatilityRegime === 'quiet') {
    s = 4; reasons.push('Quiet volatility — possible expansion ahead')
  } else {
    s = 1; reasons.push('Abnormal volatility — reduced confidence')
  }

  if (volatility.keltnerPosition === 'inside') { s = Math.min(s + 1, WEIGHTS.volatilitySuitability) }

  return { score: s, reasons }
}

function scoreExecutionQuality(
  candidate: SetupCandidate,
  features: FeatureSnapshot,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let s = 0
  const { execution } = features

  if (execution.spreadStatus === 'normal')  { s = 10; reasons.push(`Spread ${execution.spreadPips.toFixed(1)} pips — normal`) }
  else if (execution.spreadStatus === 'wide') { s = 5;  reasons.push(`Spread ${execution.spreadPips.toFixed(1)} pips — wide`) }
  else                                         { s = 0;  reasons.push(`Spread ${execution.spreadPips.toFixed(1)} pips — abnormal`) }

  return { score: s, reasons }
}

function scoreStrategyFit(
  candidate: SetupCandidate,
  features: FeatureSnapshot,
  marketState: MarketState,
  strategy?: StrategyDefinition,
): { score: number; reasons: string[] } {
  if (!strategy) return { score: 7, reasons: ['No strategy filter — default fit score'] }

  const reasons: string[] = []
  let s = 0

  const regimeOk = strategy.context.allowedRegimes.includes(marketState.regime)
  const sessionOk = strategy.context.allowedSessions.length === 0 ||
    features.session.activeSessions.some(sess =>
      strategy.context.allowedSessions.some(allowed =>
        sess.toLowerCase().includes(allowed.toLowerCase())))
  const detectorOk = strategy.allowedDetectors.includes(candidate.detector)
  const spreadOk = features.execution.spreadPips <= strategy.context.maxSpreadPips
  const rrOk = candidate.riskReward >= strategy.riskRules.minRR

  if (detectorOk) { s += 4; reasons.push('Detector matches strategy') }
  if (regimeOk)   { s += 3; reasons.push(`Regime '${marketState.regime}' allowed by strategy`) }
  if (sessionOk)  { s += 2; reasons.push('Session matches strategy') }
  if (spreadOk)   { s += 1; reasons.push('Spread within strategy limit') }
  if (!rrOk && candidate.riskReward > 0) reasons.push(`R:R ${candidate.riskReward.toFixed(2)} below strategy minimum ${strategy.riskRules.minRR}`)

  return { score: Math.min(s, WEIGHTS.strategyFit), reasons }
}

// ── Penalties ─────────────────────────────────────────────────────────────────

function computeContextPenalty(features: FeatureSnapshot): { penalty: number; reasons: string[] } {
  const reasons: string[] = []
  let p = 0

  if (features.context.calendarRisk === 'medium')   { p += 8;  reasons.push('Medium calendar risk — penalty applied') }
  if (features.context.calendarRisk === 'low')       { p += 3;  reasons.push('Low calendar risk — minor penalty') }
  if (features.context.newsRisk === 'elevated')      { p += 5;  reasons.push('Elevated news sentiment — penalty') }

  return { penalty: -Math.min(p, WEIGHTS.contextPenalty), reasons }
}

function computeOverextensionPenalty(
  candidate: SetupCandidate,
  features: FeatureSnapshot,
): { penalty: number; reasons: string[] } {
  const reasons: string[] = []
  const ext = features.structure.overextensionATR

  // Range fade and session reversal detectors intentionally use overextension — don't penalize
  if (['range_fade', 'session_reversal'].includes(candidate.detector)) {
    return { penalty: 0, reasons: [] }
  }

  let p = 0
  if (ext > 3)      { p = 10; reasons.push(`Overextension ${ext.toFixed(1)} ATR — high reversal risk`) }
  else if (ext > 2) { p = 5;  reasons.push(`Overextension ${ext.toFixed(1)} ATR — moderate risk`) }
  else if (ext > 1.5) { p = 2; reasons.push(`Overextension ${ext.toFixed(1)} ATR — minor risk`) }

  return { penalty: -Math.min(p, WEIGHTS.overextensionPenalty), reasons }
}

function computeCounterTrendPenalty(
  candidate: SetupCandidate,
  features: FeatureSnapshot,
  marketState: MarketState,
): { penalty: number; reasons: string[] } {
  if (!candidate.direction) return { penalty: 0, reasons: [] }

  const reasons: string[] = []
  const dir = candidate.direction
  const { trend, structure } = features

  const isCounterTrend =
    (dir === 'BUY'  && trend.directionBias === 'bearish' && marketState.regime === 'trend') ||
    (dir === 'SELL' && trend.directionBias === 'bullish' && marketState.regime === 'trend')

  if (!isCounterTrend) return { penalty: 0, reasons: [] }

  let p = 7
  reasons.push('Counter-trend trade in trend regime — penalty applied')
  if (structure.choch === null) { p += 3; reasons.push('No CHoCH — counter-trend without reversal signal') }

  return { penalty: -Math.min(p, WEIGHTS.counterTrendPenalty), reasons }
}

// ── Main scorer ───────────────────────────────────────────────────────────────

export function scoreCandidate(
  candidate: SetupCandidate,
  features: FeatureSnapshot,
  marketState: MarketState,
  strategy?: StrategyDefinition,
): SetupCandidate {
  // Check hard disqualifiers first
  const hardFails = checkHardDisqualifiers(candidate, features, marketState)
  if (hardFails.length > 0) {
    return {
      ...candidate,
      found: false,
      score: 0,
      tier: 'rejected',
      disqualifiers: hardFails,
      scoreBreakdown: {
        trendAlignment: 0, structureQuality: 0, entryPrecision: 0,
        stopQuality: 0, targetQuality: 0, sessionTiming: 0,
        volatilitySuitability: 0, executionQuality: 0, strategyFit: 0,
        contextPenalty: 0, overextensionPenalty: 0, counterTrendPenalty: 0,
        totalPositive: 0, totalPenalty: 0, finalScore: 0,
        reasons: hardFails,
      },
    }
  }

  // Non-found candidates get zero score
  if (!candidate.found) {
    return { ...candidate, score: 0, tier: 'rejected' }
  }

  const allReasons: string[] = []

  const trendRes   = scoreTrendAlignment(candidate, features, marketState)
  const structRes  = scoreStructureQuality(candidate, features)
  const entryRes   = scoreEntryPrecision(candidate, features)
  const stopRes    = scoreStopQuality(candidate, features)
  const targetRes  = scoreTargetQuality(candidate, features)
  const sessionRes = scoreSessionTiming(candidate, features)
  const volRes     = scoreVolatilitySuitability(candidate, features)
  const execRes    = scoreExecutionQuality(candidate, features)
  const stratRes   = scoreStrategyFit(candidate, features, marketState, strategy)

  const ctxPenalty   = computeContextPenalty(features)
  const extPenalty   = computeOverextensionPenalty(candidate, features)
  const ctrPenalty   = computeCounterTrendPenalty(candidate, features, marketState)

  const totalPositive = trendRes.score + structRes.score + entryRes.score + stopRes.score +
    targetRes.score + sessionRes.score + volRes.score + execRes.score + stratRes.score
  const totalPenalty  = ctxPenalty.penalty + extPenalty.penalty + ctrPenalty.penalty
  const finalScore    = Math.max(0, Math.min(100, Math.round(totalPositive + totalPenalty)))

  allReasons.push(
    ...trendRes.reasons, ...structRes.reasons, ...entryRes.reasons,
    ...stopRes.reasons, ...targetRes.reasons, ...sessionRes.reasons,
    ...volRes.reasons, ...execRes.reasons, ...stratRes.reasons,
    ...ctxPenalty.reasons, ...extPenalty.reasons, ...ctrPenalty.reasons,
  )

  const breakdown: ScoreBreakdown = {
    trendAlignment:        trendRes.score,
    structureQuality:      structRes.score,
    entryPrecision:        entryRes.score,
    stopQuality:           stopRes.score,
    targetQuality:         targetRes.score,
    sessionTiming:         sessionRes.score,
    volatilitySuitability: volRes.score,
    executionQuality:      execRes.score,
    strategyFit:           stratRes.score,
    contextPenalty:        ctxPenalty.penalty,
    overextensionPenalty:  extPenalty.penalty,
    counterTrendPenalty:   ctrPenalty.penalty,
    totalPositive,
    totalPenalty,
    finalScore,
    reasons: allReasons,
  }

  return {
    ...candidate,
    score:          finalScore,
    tier:           scoreTier(finalScore),
    scoreBreakdown: breakdown,
  }
}

/**
 * Score all candidates and sort by score descending.
 * Found candidates are scored fully; not-found candidates receive 0.
 */
export function scoreCandidates(
  candidates: SetupCandidate[],
  features: FeatureSnapshot,
  marketState: MarketState,
  strategy?: StrategyDefinition,
): SetupCandidate[] {
  return candidates
    .map(c => scoreCandidate(c, features, marketState, strategy))
    .sort((a, b) => b.score - a.score)
}
