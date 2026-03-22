// Wolf-Fin — Monte Carlo Layer 2: Agent-Based / Crowd Positioning
//
// Estimates where retail stop-loss clusters are sitting and whether the crowd
// is predominantly long or short, then derives a contrarian signal.
//
// Inputs used (already in the agent context):
//   • Multi-timeframe candles  — swing high/low identification
//   • Fear & Greed index       — crowd sentiment when available
//
// No external API calls — pure price-action heuristics.

import type { Candle } from './types.js'
import type { AgentBasedResult, StopCluster, LiquidityZone } from './mc-types.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Find local swing highs: a bar whose high is highest over ±window bars */
function swingHighs(candles: Candle[], window = 5): number[] {
  const highs: number[] = []
  for (let i = window; i < candles.length - window; i++) {
    const h = candles[i].high
    let isHigh = true
    for (let j = i - window; j <= i + window; j++) {
      if (j !== i && candles[j].high >= h) { isHigh = false; break }
    }
    if (isHigh) highs.push(h)
  }
  return highs
}

/** Find local swing lows: a bar whose low is lowest over ±window bars */
function swingLows(candles: Candle[], window = 5): number[] {
  const lows: number[] = []
  for (let i = window; i < candles.length - window; i++) {
    const l = candles[i].low
    let isLow = true
    for (let j = i - window; j <= i + window; j++) {
      if (j !== i && candles[j].low <= l) { isLow = false; break }
    }
    if (isLow) lows.push(l)
  }
  return lows
}

/** Cluster nearby price levels (within clusterPct% of each other) */
function cluster(prices: number[], clusterPct = 0.002): number[] {
  if (prices.length === 0) return []
  const sorted = [...prices].sort((a, b) => a - b)
  const clusters: number[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i] - clusters[clusters.length - 1]) / clusters[clusters.length - 1] > clusterPct) {
      clusters.push(sorted[i])
    }
  }
  return clusters
}

/** Strength of a stop cluster based on how many touches it aggregated */
function stopStrength(price: number, allPrices: number[], clusterPct = 0.002): 'WEAK' | 'MODERATE' | 'STRONG' {
  const count = allPrices.filter(p => Math.abs(p - price) / price <= clusterPct).length
  if (count >= 4) return 'STRONG'
  if (count >= 2) return 'MODERATE'
  return 'WEAK'
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface AgentBasedInput {
  m15: Candle[]
  h1:  Candle[]
  h4:  Candle[]
  /** Optional: Fear & Greed value (0–100).  undefined = not available. */
  fearGreedValue?: number
}

export function runAgentBased(input: AgentBasedInput): AgentBasedResult {
  const { m15, h1, h4, fearGreedValue } = input
  const currentPrice = (m15[m15.length - 1]?.close ?? h1[h1.length - 1]?.close) ?? 0

  // ── Swing levels on H1 + H4 ───────────────────────────────────────────────
  const h1Highs = swingHighs(h1, 5)
  const h1Lows  = swingLows(h1, 5)
  const h4Highs = swingHighs(h4, 3)
  const h4Lows  = swingLows(h4, 3)

  // Cluster them
  const allHighs    = cluster([...h1Highs, ...h4Highs])
  const allLows     = cluster([...h1Lows,  ...h4Lows])
  const rawHighs    = [...h1Highs, ...h4Highs]
  const rawLows     = [...h1Lows,  ...h4Lows]

  // ── Stop clusters ─────────────────────────────────────────────────────────
  // Retail longs place stops just BELOW swing lows  → LONG_STOPS just below each low
  // Retail shorts place stops just ABOVE swing highs → SHORT_STOPS just above each high
  const stopClusters: StopCluster[] = [
    ...allLows
      .filter(p => p < currentPrice && currentPrice - p < currentPrice * 0.05)
      .slice(-3)
      .map(price => ({
        price: parseFloat(price.toFixed(5)),
        direction: 'LONG_STOPS' as const,
        strength: stopStrength(price, rawLows),
        description: `Retail long stops clustered near ${price.toFixed(5)} — swing low zone`,
      })),
    ...allHighs
      .filter(p => p > currentPrice && p - currentPrice < currentPrice * 0.05)
      .slice(0, 3)
      .map(price => ({
        price: parseFloat(price.toFixed(5)),
        direction: 'SHORT_STOPS' as const,
        strength: stopStrength(price, rawHighs),
        description: `Retail short stops clustered near ${price.toFixed(5)} — swing high zone`,
      })),
  ]

  // ── Liquidity zones ───────────────────────────────────────────────────────
  const atrApprox = h1.length >= 2
    ? h1.slice(-14).reduce((s, c, i, a) =>
        i === 0 ? 0 : s + Math.abs(c.close - a[i - 1].close), 0) / Math.min(13, h1.length - 1)
    : currentPrice * 0.002

  const liquidityZones: LiquidityZone[] = [
    ...allHighs.slice(-2).map(p => ({
      priceHigh: parseFloat((p + atrApprox * 0.5).toFixed(5)),
      priceLow:  parseFloat((p - atrApprox * 0.5).toFixed(5)),
      type:      'RESISTANCE' as const,
      description: `H1/H4 resistance zone around ${p.toFixed(5)}`,
    })),
    ...allLows.slice(0, 2).map(p => ({
      priceHigh: parseFloat((p + atrApprox * 0.5).toFixed(5)),
      priceLow:  parseFloat((p - atrApprox * 0.5).toFixed(5)),
      type:      'SUPPORT' as const,
      description: `H1/H4 support zone around ${p.toFixed(5)}`,
    })),
  ]

  // ── Crowd bias (Fear & Greed + price-action proxy) ────────────────────────
  // Fear & Greed: 0–25 extreme fear (crowd short), 75–100 extreme greed (crowd long)
  let crowdBias = 0
  let sentimentSource = 'Price action only'

  if (fearGreedValue !== undefined) {
    // Normalise 0–100 → -1 to +1
    crowdBias = (fearGreedValue - 50) / 50
    sentimentSource = `Fear & Greed (${fearGreedValue}) + price action`
  } else {
    // Price-action proxy: if price is in upper 60% of recent H4 range, crowd likely long
    const h4Range = h4.slice(-20)
    if (h4Range.length >= 2) {
      const rangeHigh = Math.max(...h4Range.map(c => c.high))
      const rangeLow  = Math.min(...h4Range.map(c => c.low))
      const rangePct  = rangeHigh > rangeLow
        ? (currentPrice - rangeLow) / (rangeHigh - rangeLow)
        : 0.5
      crowdBias = (rangePct - 0.5) * 1.2   // amplify slightly
    }
  }

  crowdBias = Math.max(-1, Math.min(1, crowdBias))

  const crowdBiasLabel = (() => {
    if (crowdBias >  0.6) return 'HEAVILY_LONG'  as const
    if (crowdBias >  0.2) return 'SLIGHTLY_LONG' as const
    if (crowdBias < -0.6) return 'HEAVILY_SHORT' as const
    if (crowdBias < -0.2) return 'SLIGHTLY_SHORT'as const
    return 'NEUTRAL' as const
  })()

  // ── Contrarian signal ─────────────────────────────────────────────────────
  // Smart money often fades extreme retail positioning
  const contrarianSignal = (() => {
    if (crowdBias >  0.6) return 'FADE_LONGS'  as const
    if (crowdBias < -0.6) return 'FADE_SHORTS' as const
    return 'NO_SIGNAL' as const
  })()

  // Path bias: fade the crowd → invert crowdBias signal
  const pathBias = (() => {
    switch (contrarianSignal) {
      case 'FADE_LONGS':  return -crowdBias * 0.5   // bearish lean when crowd is long
      case 'FADE_SHORTS': return -crowdBias * 0.5   // bullish lean when crowd is short
      default:            return 0
    }
  })()

  return {
    crowdBias: parseFloat(crowdBias.toFixed(3)),
    crowdBiasLabel,
    stopClusters,
    liquidityZones,
    contrarianSignal,
    pathBias: parseFloat(pathBias.toFixed(3)),
    sentimentSource,
  }
}
