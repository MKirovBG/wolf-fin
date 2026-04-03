// Wolf-Fin — Candlestick pattern detection
// Detects common single-, two-, and three-candle patterns from the last N candles.
// Results are passed to the LLM as structured facts and overlaid on the chart.

import type { Candle } from './types.js'
import type { CandlePattern } from '../types.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function body(c: Candle): number { return Math.abs(c.close - c.open) }
function range(c: Candle): number { return c.high - c.low }
function upperWick(c: Candle): number { return c.high - Math.max(c.open, c.close) }
function lowerWick(c: Candle): number { return Math.min(c.open, c.close) - c.low }
function isBullish(c: Candle): boolean { return c.close >= c.open }
function isBearish(c: Candle): boolean { return c.close < c.open }
function mid(c: Candle): number { return (c.high + c.low) / 2 }

// ── Single-candle patterns ────────────────────────────────────────────────────

function isDoji(c: Candle): boolean {
  const r = range(c)
  return r > 0 && body(c) / r < 0.1
}

// Pin bar: small body, long wick (wick > 2× body), occurs at a swing extreme.
// Direction determined by which wick dominates.
function isPinBar(c: Candle): 'bullish' | 'bearish' | null {
  const b = body(c)
  const r = range(c)
  if (r === 0) return null
  const upper = upperWick(c)
  const lower = lowerWick(c)
  const bodyRatio = b / r

  if (bodyRatio > 0.4) return null  // body too large

  // Bearish pin (shooting star / inverted hammer at top): long upper wick
  if (upper > 2 * b && upper > lower * 1.5) return 'bearish'
  // Bullish pin (hammer): long lower wick
  if (lower > 2 * b && lower > upper * 1.5) return 'bullish'
  return null
}

// ── Two-candle patterns ───────────────────────────────────────────────────────

function isEngulfing(prev: Candle, curr: Candle): 'bullish' | 'bearish' | null {
  if (isBullish(curr) && isBearish(prev)) {
    if (curr.close > prev.open && curr.open < prev.close) return 'bullish'
  }
  if (isBearish(curr) && isBullish(prev)) {
    if (curr.close < prev.open && curr.open > prev.close) return 'bearish'
  }
  return null
}

function isInsideBar(prev: Candle, curr: Candle): boolean {
  return curr.high <= prev.high && curr.low >= prev.low
}

function isHarami(prev: Candle, curr: Candle): 'bullish' | 'bearish' | null {
  if (body(prev) === 0) return null
  // Previous is large, current is small and inside previous body
  if (body(curr) < body(prev) * 0.5 &&
      Math.max(curr.open, curr.close) < Math.max(prev.open, prev.close) &&
      Math.min(curr.open, curr.close) > Math.min(prev.open, prev.close)) {
    if (isBearish(prev) && isBullish(curr)) return 'bullish'
    if (isBullish(prev) && isBearish(curr)) return 'bearish'
  }
  return null
}

// Tweezer tops/bottoms: two candles with matching highs (top) or lows (bottom)
function isTweezer(prev: Candle, curr: Candle, digits: number): 'bullish' | 'bearish' | null {
  const tolerance = Math.pow(10, -digits) * 2
  if (isBullish(prev) && isBearish(curr) && Math.abs(prev.high - curr.high) < tolerance) return 'bearish'
  if (isBearish(prev) && isBullish(curr) && Math.abs(prev.low  - curr.low)  < tolerance) return 'bullish'
  return null
}

// ── Three-candle patterns ─────────────────────────────────────────────────────

function isMorningStar(c1: Candle, c2: Candle, c3: Candle): boolean {
  return (
    isBearish(c1) && body(c1) > range(c1) * 0.5 &&
    body(c2) < body(c1) * 0.3 &&
    isBullish(c3) && body(c3) > range(c3) * 0.5 &&
    c3.close > mid(c1)
  )
}

function isEveningStar(c1: Candle, c2: Candle, c3: Candle): boolean {
  return (
    isBullish(c1) && body(c1) > range(c1) * 0.5 &&
    body(c2) < body(c1) * 0.3 &&
    isBearish(c3) && body(c3) > range(c3) * 0.5 &&
    c3.close < mid(c1)
  )
}

function isThreeWhiteSoldiers(c1: Candle, c2: Candle, c3: Candle): boolean {
  return (
    isBullish(c1) && isBullish(c2) && isBullish(c3) &&
    c2.open > c1.open && c2.close > c1.close &&
    c3.open > c2.open && c3.close > c2.close &&
    body(c1) > 0 && body(c2) > 0 && body(c3) > 0
  )
}

function isThreeBlackCrows(c1: Candle, c2: Candle, c3: Candle): boolean {
  return (
    isBearish(c1) && isBearish(c2) && isBearish(c3) &&
    c2.open < c1.open && c2.close < c1.close &&
    c3.open < c2.open && c3.close < c2.close &&
    body(c1) > 0 && body(c2) > 0 && body(c3) > 0
  )
}

// ── Main detector ──────────────────────────────────────────────────────────────

export function detectPatterns(candles: Candle[], digits = 5): CandlePattern[] {
  const patterns: CandlePattern[] = []
  if (candles.length < 3) return patterns

  // Only scan the most recent 20 candles to keep results focused
  const start = Math.max(0, candles.length - 20)

  for (let i = start; i < candles.length; i++) {
    const c  = candles[i]
    const c1 = i >= 1 ? candles[i - 1] : null
    const c2 = i >= 2 ? candles[i - 2] : null

    // Single-candle
    if (isDoji(c)) {
      patterns.push({
        name:        'Doji',
        direction:   'neutral',
        price:       c.close,
        barIndex:    i,
        description: 'Indecision candle — open and close nearly equal',
      })
    }

    const pinDir = isPinBar(c)
    if (pinDir) {
      const name = pinDir === 'bullish' ? 'Hammer' : 'Shooting Star'
      patterns.push({
        name,
        direction:   pinDir,
        price:       c.close,
        barIndex:    i,
        description: pinDir === 'bullish'
          ? 'Long lower wick — buyers rejecting lower prices'
          : 'Long upper wick — sellers rejecting higher prices',
      })
    }

    // Two-candle (need previous)
    if (c1) {
      const engDir = isEngulfing(c1, c)
      if (engDir) {
        patterns.push({
          name:        engDir === 'bullish' ? 'Bullish Engulfing' : 'Bearish Engulfing',
          direction:   engDir,
          price:       c.close,
          barIndex:    i,
          description: engDir === 'bullish'
            ? 'Bullish candle fully engulfs previous bearish — strong reversal signal'
            : 'Bearish candle fully engulfs previous bullish — strong reversal signal',
        })
      }

      if (isInsideBar(c1, c)) {
        patterns.push({
          name:        'Inside Bar',
          direction:   'neutral',
          price:       c.close,
          barIndex:    i,
          description: 'Price range within prior candle — consolidation / breakout pending',
        })
      }

      const haramiDir = isHarami(c1, c)
      if (haramiDir) {
        patterns.push({
          name:        haramiDir === 'bullish' ? 'Bullish Harami' : 'Bearish Harami',
          direction:   haramiDir,
          price:       c.close,
          barIndex:    i,
          description: haramiDir === 'bullish'
            ? 'Small bullish candle inside large bearish — potential reversal'
            : 'Small bearish candle inside large bullish — potential reversal',
        })
      }

      const tweezDir = isTweezer(c1, c, digits)
      if (tweezDir) {
        patterns.push({
          name:        tweezDir === 'bullish' ? 'Tweezer Bottom' : 'Tweezer Top',
          direction:   tweezDir,
          price:       c.close,
          barIndex:    i,
          description: tweezDir === 'bullish'
            ? 'Matching lows — buyers defending a level'
            : 'Matching highs — sellers capping a level',
        })
      }
    }

    // Three-candle (need two previous)
    if (c1 && c2) {
      if (isMorningStar(c2, c1, c)) {
        patterns.push({
          name:        'Morning Star',
          direction:   'bullish',
          price:       c.close,
          barIndex:    i,
          description: 'Three-candle bullish reversal pattern — bearish, small body, bullish',
        })
      }
      if (isEveningStar(c2, c1, c)) {
        patterns.push({
          name:        'Evening Star',
          direction:   'bearish',
          price:       c.close,
          barIndex:    i,
          description: 'Three-candle bearish reversal pattern — bullish, small body, bearish',
        })
      }
      if (isThreeWhiteSoldiers(c2, c1, c)) {
        patterns.push({
          name:        'Three White Soldiers',
          direction:   'bullish',
          price:       c.close,
          barIndex:    i,
          description: 'Three consecutive higher-closing bullish candles — strong momentum',
        })
      }
      if (isThreeBlackCrows(c2, c1, c)) {
        patterns.push({
          name:        'Three Black Crows',
          direction:   'bearish',
          price:       c.close,
          barIndex:    i,
          description: 'Three consecutive lower-closing bearish candles — strong selling pressure',
        })
      }
    }
  }

  // Deduplicate: if multiple patterns fire on the same bar, keep the most specific
  // (prefer multi-candle > single-candle; keep only the latest bar occurrence per name)
  const seen = new Map<string, CandlePattern>()
  for (const p of patterns) {
    const existing = seen.get(p.name)
    if (!existing || p.barIndex > existing.barIndex) seen.set(p.name, p)
  }

  return Array.from(seen.values()).sort((a, b) => b.barIndex - a.barIndex)
}
