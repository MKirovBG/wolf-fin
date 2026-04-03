// Wolf-Fin — Feature Engine
// Transforms raw candles + pre-computed indicators + context into a typed FeatureSnapshot.
// All downstream modules (state classifier, scorer, prompt builder) consume this output.

import { ema as computeEma, atr as computeAtr } from '../adapters/indicators.js'
import type { Candle, Indicators, KeyLevel } from '../adapters/types.js'
import type { AnalysisContext } from '../types.js'
import type {
  FeatureSnapshot,
  TrendFeatures,
  VolatilityFeatures,
  StructureFeatures,
  LevelFeatures,
  SessionFeatures,
  ExecutionFeatures,
  ContextFeatures,
} from '../types/market.js'

// ── Swing detection ───────────────────────────────────────────────────────────

interface SwingPoint { price: number; barIndex: number }

function findSwings(candles: Candle[], lookback = 2): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = []
  const lows:  SwingPoint[] = []
  const n = candles.length

  for (let i = lookback; i < n - lookback; i++) {
    const c = candles[i]
    // Swing high: higher than lookback bars on each side
    let isHigh = true
    let isLow  = true
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) isHigh = false
      if (candles[i - j].low  <= c.low  || candles[i + j].low  <= c.low)  isLow  = false
    }
    if (isHigh) highs.push({ price: c.high, barIndex: i })
    if (isLow)  lows.push({ price: c.low,   barIndex: i })
  }
  return { highs, lows }
}

// ── Trend features ────────────────────────────────────────────────────────────

function buildTrendFeatures(
  candles: Candle[],
  ind: Indicators,
  indicatorCfg: { emaFast?: number; emaSlow?: number } = {},
): TrendFeatures {
  const price = candles[candles.length - 1].close
  const emaFastPeriod = indicatorCfg.emaFast ?? 20
  const emaSlowPeriod = indicatorCfg.emaSlow ?? 50

  // EMA slope: compare current EMA to EMA computed 5 bars ago
  const emaFastNow = ind.ema20 ?? computeEma(candles, emaFastPeriod)
  const emaSlowNow = ind.ema50 ?? computeEma(candles, emaSlowPeriod)

  const slopeLookback = Math.min(5, candles.length - emaFastPeriod - 1)
  const emaFastPrev = slopeLookback > 0 ? computeEma(candles.slice(0, -slopeLookback), emaFastPeriod) : emaFastNow
  const emaSlowPrev = slopeLookback > 0 ? computeEma(candles.slice(0, -slopeLookback), emaSlowPeriod) : emaSlowNow

  const emaFastSlope = slopeLookback > 0 ? ((emaFastNow - emaFastPrev) / price) * 100 / slopeLookback : 0
  const emaSlowSlope = slopeLookback > 0 ? ((emaSlowNow - emaSlowPrev) / price) * 100 / slopeLookback : 0

  const priceVsEmaFast = ((price - emaFastNow) / price) * 100
  const priceVsEmaSlow = ((price - emaSlowNow) / price) * 100

  const emaAlignment: TrendFeatures['emaAlignment'] =
    emaFastNow > emaSlowNow * 1.0001 ? 'bullish'
    : emaFastNow < emaSlowNow * 0.9999 ? 'bearish'
    : 'neutral'

  const rsiValue = ind.rsi14 ?? 50
  const rsiZone: TrendFeatures['rsiZone'] =
    rsiValue < 35 ? 'oversold' : rsiValue > 65 ? 'overbought' : 'neutral'

  const adxValue = ind.adx?.adx ?? 0
  const adxStrength: TrendFeatures['adxStrength'] =
    adxValue >= 35 ? 'strong' : adxValue >= 20 ? 'moderate' : 'weak'

  const macdBias: TrendFeatures['macdBias'] = ind.macd
    ? ind.macd.histogram > 0 ? 'bullish' : ind.macd.histogram < 0 ? 'bearish' : 'neutral'
    : undefined

  const psarBias: TrendFeatures['psarBias'] = ind.psar
    ? ind.psar.bullish ? 'bullish' : 'bearish'
    : undefined

  const mtfScore = ind.mtf?.confluence
  const mtfAlignment: TrendFeatures['mtfAlignment'] =
    mtfScore == null ? 'neutral'
    : mtfScore >= 2  ? 'aligned_bullish'
    : mtfScore <= -2 ? 'aligned_bearish'
    : Math.abs(mtfScore) >= 1 ? 'divergent'
    : 'neutral'

  // Direction score: each signal contributes ±1 (or ±0.5)
  let bullScore = 0
  let bearScore = 0

  if (emaAlignment === 'bullish') { bullScore += 1.5 }
  if (emaAlignment === 'bearish') { bearScore += 1.5 }
  if (priceVsEmaFast > 0) { bullScore += 0.5 } else { bearScore += 0.5 }
  if (priceVsEmaSlow > 0) { bullScore += 0.5 } else { bearScore += 0.5 }
  if (macdBias === 'bullish') { bullScore += 1 } else if (macdBias === 'bearish') { bearScore += 1 }
  if (psarBias === 'bullish') { bullScore += 1 } else if (psarBias === 'bearish') { bearScore += 1 }
  if (rsiValue > 55) { bullScore += 0.5 } else if (rsiValue < 45) { bearScore += 0.5 }
  if (mtfScore != null && mtfScore > 0) { bullScore += Math.abs(mtfScore) * 0.5 }
  if (mtfScore != null && mtfScore < 0) { bearScore += Math.abs(mtfScore) * 0.5 }
  if (ind.obv?.rising) { bullScore += 0.5 } else if (ind.obv && !ind.obv.rising) { bearScore += 0.5 }

  const maxScore = 7  // sum of max possible contributions
  const net = bullScore - bearScore
  const directionBias: TrendFeatures['directionBias'] =
    net > 0.5 ? 'bullish' : net < -0.5 ? 'bearish' : 'neutral'
  const directionStrength = Math.round(Math.min(Math.abs(net) / maxScore, 1) * 100)

  return {
    emaFastSlope: +emaFastSlope.toFixed(4),
    emaSlowSlope: +emaSlowSlope.toFixed(4),
    priceVsEmaFast: +priceVsEmaFast.toFixed(4),
    priceVsEmaSlow: +priceVsEmaSlow.toFixed(4),
    emaAlignment,
    rsiValue: +rsiValue.toFixed(1),
    rsiZone,
    adxValue: +adxValue.toFixed(1),
    adxStrength,
    directionBias,
    directionStrength,
    macdBias,
    psarBias,
    mtfScore,
    mtfAlignment,
  }
}

// ── Volatility features ───────────────────────────────────────────────────────

function buildVolatilityFeatures(
  candles: Candle[],
  ind: Indicators,
  point: number,
): VolatilityFeatures {
  const atrAbsolute = ind.atr14 ?? computeAtr(candles, 14)
  const atrPips = point > 0 ? atrAbsolute / point : 0
  const bbWidthPct = ind.bbWidth != null ? ind.bbWidth * 100 : 0

  // Range expansion: avg body range of last 5 vs prior 5
  const last5 = candles.slice(-5)
  const prev5 = candles.slice(-10, -5)
  const avgRange = (arr: Candle[]) => arr.length
    ? arr.reduce((s, c) => s + (c.high - c.low), 0) / arr.length
    : 0
  const recentRangeExpansion = prev5.length > 0 && avgRange(last5) > avgRange(prev5) * 1.1

  // Volatility percentile: compute per-bar ATR for last 50 bars, rank current
  const atrValues: number[] = []
  const lookback = Math.min(candles.length, 52)
  for (let i = 15; i < lookback; i++) {
    atrValues.push(computeAtr(candles.slice(0, i), 14))
  }
  const below = atrValues.filter(v => v <= atrAbsolute).length
  const volatilityPercentile = atrValues.length > 0
    ? Math.round((below / atrValues.length) * 100)
    : 50

  const volatilityRegime: VolatilityFeatures['volatilityRegime'] =
    volatilityPercentile >= 85 ? 'abnormal'
    : volatilityPercentile >= 65 ? 'elevated'
    : volatilityPercentile >= 25 ? 'normal'
    : 'quiet'

  const price = candles[candles.length - 1].close
  let keltnerPosition: VolatilityFeatures['keltnerPosition'] = undefined
  if (ind.keltner) {
    keltnerPosition = price > ind.keltner.upper ? 'above'
      : price < ind.keltner.lower ? 'below'
      : 'inside'
  }

  return {
    atrAbsolute: +atrAbsolute.toFixed(6),
    atrPips: +atrPips.toFixed(1),
    bbWidthPct: +bbWidthPct.toFixed(3),
    recentRangeExpansion,
    volatilityRegime,
    volatilityPercentile,
    keltnerPosition,
  }
}

// ── Structure features ────────────────────────────────────────────────────────

function buildStructureFeatures(candles: Candle[], ind: Indicators): StructureFeatures {
  const n = candles.length
  const price = candles[n - 1].close
  const { highs, lows } = findSwings(candles, 2)

  // Most recent swing high / low
  const lastHigh = highs.length ? highs[highs.length - 1] : { price: candles[n - 1].high, barIndex: n - 1 }
  const lastLow  = lows.length  ? lows[lows.length - 1]   : { price: candles[n - 1].low,  barIndex: n - 1 }

  const swingHighAge = n - 1 - lastHigh.barIndex
  const swingLowAge  = n - 1 - lastLow.barIndex

  // Trend direction from swing structure (last 2 highs and lows)
  const prevHigh = highs.length >= 2 ? highs[highs.length - 2] : null
  const prevLow  = lows.length  >= 2 ? lows[lows.length - 2]   : null

  let trendDirection: StructureFeatures['trendDirection'] = 'ranging'
  if (prevHigh && prevLow) {
    const higherHighs = lastHigh.price > prevHigh.price
    const higherLows  = lastLow.price  > prevLow.price
    const lowerHighs  = lastHigh.price < prevHigh.price
    const lowerLows   = lastLow.price  < prevLow.price
    if (higherHighs && higherLows) trendDirection = 'uptrend'
    else if (lowerHighs && lowerLows) trendDirection = 'downtrend'
  }

  // BOS: price closes beyond the most recent swing point
  let bos: StructureFeatures['bos'] = null
  if (price > lastHigh.price) bos = 'bullish'
  else if (price < lastLow.price) bos = 'bearish'

  // CHoCH: structure flip signal (simplified — opposite BOS in existing trend)
  let choch: StructureFeatures['choch'] = null
  if (trendDirection === 'downtrend' && bos === 'bullish') choch = 'bullish'
  if (trendDirection === 'uptrend'   && bos === 'bearish') choch = 'bearish'

  // Pullback depth: in a trend, how deep is the current retrace vs the last impulse
  let pullbackDepthPct = 0
  const atr = ind.atr14 ?? 0
  if (trendDirection === 'uptrend' && prevLow) {
    const impulseSize = lastHigh.price - prevLow.price
    const currentRetrace = lastHigh.price - price
    pullbackDepthPct = impulseSize > 0 ? Math.min((currentRetrace / impulseSize) * 100, 100) : 0
  } else if (trendDirection === 'downtrend' && prevHigh) {
    const impulseSize = prevHigh.price - lastLow.price
    const currentRetrace = price - lastLow.price
    pullbackDepthPct = impulseSize > 0 ? Math.min((currentRetrace / impulseSize) * 100, 100) : 0
  }

  // Overextension: how many ATR units from the nearest swing
  const distToNearestSwing = Math.min(
    Math.abs(price - lastHigh.price),
    Math.abs(price - lastLow.price),
  )
  const overextensionATR = atr > 0 ? +(distToNearestSwing / atr).toFixed(2) : 0

  return {
    recentSwingHigh: +lastHigh.price.toFixed(6),
    recentSwingLow:  +lastLow.price.toFixed(6),
    swingHighAge,
    swingLowAge,
    bos,
    choch,
    trendDirection,
    pullbackDepthPct: +pullbackDepthPct.toFixed(1),
    overextensionATR,
  }
}

// ── Level features ────────────────────────────────────────────────────────────

function buildLevelFeatures(
  candles: Candle[],
  ind: Indicators,
  keyLevels: KeyLevel[],
): LevelFeatures {
  const price = candles[candles.length - 1].close

  // VWAP distance
  let vwapDistance = 0
  let vwapSide: LevelFeatures['vwapSide'] = undefined
  if (ind.vwap && ind.vwap > 0) {
    vwapDistance = +((price - ind.vwap) / price * 100).toFixed(4)
    vwapSide = vwapDistance >= 0 ? 'above' : 'below'
    vwapDistance = Math.abs(vwapDistance)
  }

  // Nearest support / resistance from bridge key levels
  const supports    = keyLevels.filter(l => l.type === 'support'    || l.type === 'swing_low')
  const resistances = keyLevels.filter(l => l.type === 'resistance' || l.type === 'swing_high')

  const nearest = (levels: KeyLevel[], fromPrice: number) =>
    levels.length
      ? Math.min(...levels.map(l => Math.abs(l.price - fromPrice) / fromPrice * 100))
      : 0

  const nearestSupportDist  = +nearest(supports,    price).toFixed(4)
  const nearestResistDist   = +nearest(resistances, price).toFixed(4)

  // Round number proximity (nearest 10/50/100/500/1000 depending on price magnitude)
  function nearestRound(p: number): number {
    const magnitude = Math.pow(10, Math.floor(Math.log10(p)) - 1)
    const step = magnitude * 10
    const rounded = Math.round(p / step) * step
    return Math.abs(p - rounded) / p * 100
  }
  const roundNumberProximity = +nearestRound(price).toFixed(4)

  // Nearest fib level
  let nearestFibLabel: string | undefined = undefined
  if (ind.fib && ind.fib.length > 0) {
    let minDist = Infinity
    for (const f of ind.fib) {
      const dist = Math.abs(f.price - price) / price * 100
      if (dist < minDist) {
        minDist = dist
        nearestFibLabel = dist < 0.3 ? f.label : undefined
      }
    }
  }

  return {
    vwapDistance: +(Math.abs(vwapDistance)).toFixed(4),
    vwapSide,
    nearestSupportDist,
    nearestResistDist,
    roundNumberProximity,
    nearestFibLabel,
  }
}

// ── Session features ──────────────────────────────────────────────────────────

function buildSessionFeatures(ctx: AnalysisContext): SessionFeatures {
  const s = ctx.session
  if (!s) {
    return {
      activeSessions: [],
      isLondonNYOverlap: false,
      isOptimalSession: false,
      sessionQuality: 'poor',
      sessionNote: 'No session data',
    }
  }

  let sessionQuality: SessionFeatures['sessionQuality'] = 'poor'
  if (s.isLondonNYOverlap) sessionQuality = 'optimal'
  else if (s.isOptimalSession) sessionQuality = 'favorable'
  else if (s.activeSessions.length > 0) sessionQuality = 'acceptable'

  return {
    activeSessions: s.activeSessions,
    isLondonNYOverlap: s.isLondonNYOverlap,
    isOptimalSession: s.isOptimalSession,
    sessionQuality,
    sessionNote: s.note,
  }
}

// ── Execution features ────────────────────────────────────────────────────────

function buildExecutionFeatures(
  ctx: AnalysisContext,
  point: number,
  symbol: string,
): ExecutionFeatures {
  const spread = ctx.currentPrice?.spread ?? 0
  const spreadPips = point > 0 ? +(spread / point).toFixed(1) : 0

  // Thresholds vary by asset class — rough heuristic
  const isForex = /^[A-Z]{6}$/.test(symbol.replace(/[^A-Z]/g, ''))
  const isMetal = /XAU|XAG/.test(symbol)
  const normalMax = isMetal ? 40 : isForex ? 5 : 20

  const spreadStatus: ExecutionFeatures['spreadStatus'] =
    spreadPips > normalMax * 2.5 ? 'abnormal'
    : spreadPips > normalMax     ? 'wide'
    : 'normal'

  return { spreadPips, spreadStatus }
}

// ── Context features ──────────────────────────────────────────────────────────

function buildContextFeatures(ctx: AnalysisContext): ContextFeatures {
  const news = ctx.news ?? []
  const calendar = ctx.calendar ?? []

  const newsCount = news.length
  const newsRisk: ContextFeatures['newsRisk'] =
    newsCount === 0 ? 'none'
    : news.some(n => n.sentiment === 'negative' || n.sentiment === 'positive') ? 'elevated'
    : 'low'

  // Find next high-impact calendar event
  let nextHighImpactMinutes: number | null = null
  let calendarRisk: ContextFeatures['calendarRisk'] = 'none'
  const now = Date.now()

  for (const ev of calendar) {
    const evTime = new Date(ev.time).getTime()
    const minutesAway = (evTime - now) / 60000
    if (ev.impact === 'high' && minutesAway > -5 && minutesAway < 120) {
      if (nextHighImpactMinutes === null || minutesAway < nextHighImpactMinutes) {
        nextHighImpactMinutes = Math.round(minutesAway)
      }
    }
  }

  if (nextHighImpactMinutes !== null) {
    calendarRisk = nextHighImpactMinutes < 15 ? 'high'
      : nextHighImpactMinutes < 30 ? 'medium'
      : 'low'
  } else if (calendar.some(e => e.impact === 'high')) {
    calendarRisk = 'low'
  }

  // Dominant sentiment from news
  const bullCount = news.filter(n => n.sentiment === 'positive').length
  const bearCount = news.filter(n => n.sentiment === 'negative').length
  const dominantSentiment: ContextFeatures['dominantSentiment'] =
    newsCount === 0  ? 'none'
    : bullCount > bearCount ? 'bullish'
    : bearCount > bullCount ? 'bearish'
    : 'neutral'

  return {
    newsRisk,
    newsCount,
    calendarRisk,
    nextHighImpactMinutes,
    dominantSentiment,
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function computeFeatures(params: {
  symbolKey: string
  symbol: string
  candles: Candle[]
  indicators: Indicators
  context: AnalysisContext
  keyLevels: KeyLevel[]
  point: number
  indicatorCfg?: { emaFast?: number; emaSlow?: number }
}): FeatureSnapshot {
  const { symbolKey, symbol, candles, indicators, context, keyLevels, point, indicatorCfg } = params

  return {
    symbolKey,
    capturedAt: new Date().toISOString(),
    trend:      buildTrendFeatures(candles, indicators, indicatorCfg),
    volatility: buildVolatilityFeatures(candles, indicators, point),
    structure:  buildStructureFeatures(candles, indicators),
    levels:     buildLevelFeatures(candles, indicators, keyLevels),
    session:    buildSessionFeatures(context),
    execution:  buildExecutionFeatures(context, point, symbol),
    context:    buildContextFeatures(context),
  }
}
