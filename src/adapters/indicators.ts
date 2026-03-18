// Wolf-Fin Indicators — pre-computed technical signals from OHLCV candle arrays

import type { Candle } from './types.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function closes(candles: Candle[]): number[] {
  return candles.map(c => c.close)
}

// ── RSI (14) ─────────────────────────────────────────────────────────────────

export function rsi(candles: Candle[], period = 14): number {
  const prices = closes(candles)
  if (prices.length < period + 1) return 50 // neutral fallback

  let avgGain = 0
  let avgLoss = 0

  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1]
    if (diff >= 0) avgGain += diff
    else avgLoss += Math.abs(diff)
  }
  avgGain /= period
  avgLoss /= period

  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1]
    const gain = diff >= 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

// ── EMA ───────────────────────────────────────────────────────────────────────

export function ema(candles: Candle[], period: number): number {
  const prices = closes(candles)
  if (prices.length < period) return prices[prices.length - 1] ?? 0

  const k = 2 / (period + 1)
  let value = prices.slice(0, period).reduce((a, b) => a + b, 0) / period

  for (let i = period; i < prices.length; i++) {
    value = prices[i] * k + value * (1 - k)
  }
  return value
}

// ── ATR (14) ──────────────────────────────────────────────────────────────────

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0

  const trs: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high
    const low = candles[i].low
    const prevClose = candles[i - 1].close
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)))
  }

  // Wilder smoothing: seed with simple average, then smooth
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period
  }
  return atrVal
}

// ── VWAP ──────────────────────────────────────────────────────────────────────
// Typical price VWAP across provided candles (intraday session approximation)

export function vwap(candles: Candle[]): number {
  let cumulativePV = 0
  let cumulativeVol = 0

  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3
    cumulativePV += typical * c.volume
    cumulativeVol += c.volume
  }

  return cumulativeVol === 0 ? 0 : cumulativePV / cumulativeVol
}

// ── Bollinger Band Width ───────────────────────────────────────────────────────
// BB width = (upper - lower) / middle, using 20-period SMA and 2 std devs

export function bbWidth(candles: Candle[], period = 20, stdDevMultiplier = 2): number {
  const prices = closes(candles)
  if (prices.length < period) return 0

  const slice = prices.slice(-period)
  const middle = slice.reduce((a, b) => a + b, 0) / period
  const variance = slice.reduce((sum, p) => sum + (p - middle) ** 2, 0) / period
  const stdDev = Math.sqrt(variance)

  const upper = middle + stdDevMultiplier * stdDev
  const lower = middle - stdDevMultiplier * stdDev

  return middle === 0 ? 0 : (upper - lower) / middle
}

// ── Bundle: compute all indicators from 1h candles (primary timeframe) ────────

import type { Indicators, KeyLevel } from './types.js'

export function computeIndicators(h1Candles: Candle[]): Indicators {
  return {
    rsi14: rsi(h1Candles, 14),
    ema20: ema(h1Candles, 20),
    ema50: ema(h1Candles, 50),
    atr14: atr(h1Candles, 14),
    vwap: vwap(h1Candles),
    bbWidth: bbWidth(h1Candles, 20),
  }
}

// ── Key Levels (Support / Resistance / Pivots) ────────────────────────────────
// Computes key price levels from H4 and H1 candle history.
// Returns levels sorted by proximity to current price.

/**
 * Detect swing highs/lows from a candle series.
 * A swing high: candle[i].high is the highest in a window of (lookback) candles on each side.
 * A swing low: candle[i].low is the lowest in a window of (lookback) candles on each side.
 */
function swingPoints(candles: Candle[], lookback = 3): { highs: number[]; lows: number[] } {
  const highs: number[] = []
  const lows: number[] = []
  // Use candles[lookback..candles.length-lookback-1] so we have context on both sides
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1)
    const isSwingHigh = candles[i].high === Math.max(...window.map(c => c.high))
    const isSwingLow  = candles[i].low  === Math.min(...window.map(c => c.low))
    if (isSwingHigh) highs.push(candles[i].high)
    if (isSwingLow)  lows.push(candles[i].low)
  }
  return { highs, lows }
}

export function computeKeyLevels(
  h4Candles: Candle[],
  h1Candles: Candle[],
  currentPrice: number,
): KeyLevel[] {
  const levels: KeyLevel[] = []

  // ── 1. Recent daily highs/lows (from H4 — 6 H4 candles = 1 day) ─────────
  // Group H4 into 'days' and pull high/low per day (last 5 days = 30 H4 candles)
  const days = Math.min(5, Math.floor(h4Candles.length / 6))
  for (let d = 0; d < days; d++) {
    const slice = h4Candles.slice(-(d + 1) * 6, d === 0 ? undefined : -d * 6)
    if (slice.length === 0) continue
    const dayHigh = Math.max(...slice.map(c => c.high))
    const dayLow  = Math.min(...slice.map(c => c.low))
    const strength = d === 0 ? 3 : d === 1 ? 2 : 1
    const label = d === 0 ? 'today' : `${d + 1}d_ago`
    levels.push({ price: dayHigh, type: 'resistance', source: `daily_high_${label}`, strength })
    levels.push({ price: dayLow,  type: 'support',    source: `daily_low_${label}`,  strength })
  }

  // ── 2. Weekly pivot points (from last 5 H4 days ≈ 1 trading week) ────────
  if (h4Candles.length >= 30) {
    const weekCandles = h4Candles.slice(-30)
    const wH = Math.max(...weekCandles.map(c => c.high))
    const wL = Math.min(...weekCandles.map(c => c.low))
    const wC = weekCandles[weekCandles.length - 1].close
    const pp = (wH + wL + wC) / 3
    levels.push({ price: pp,             type: 'pivot',      source: 'weekly_pp',  strength: 3 })
    levels.push({ price: 2 * pp - wL,    type: 'resistance', source: 'weekly_r1',  strength: 2 })
    levels.push({ price: pp + (wH - wL), type: 'resistance', source: 'weekly_r2',  strength: 2 })
    levels.push({ price: 2 * pp - wH,    type: 'support',    source: 'weekly_s1',  strength: 2 })
    levels.push({ price: pp - (wH - wL), type: 'support',    source: 'weekly_s2',  strength: 2 })
  }

  // ── 3. H1 swing highs/lows (last 48 candles = 2 days) ──────────────────
  const recentH1 = h1Candles.slice(-48)
  const { highs: swingHighs, lows: swingLows } = swingPoints(recentH1, 3)
  // Take the 4 most recent distinct swing highs and lows
  const seen = new Set<number>()
  const dedupe = (arr: number[]) => arr.filter(p => {
    // Round to 5 sig figs to merge near-identical levels
    const rounded = parseFloat(p.toPrecision(5))
    if (seen.has(rounded)) return false
    seen.add(rounded)
    return true
  })
  for (const p of dedupe(swingHighs).slice(-4)) {
    levels.push({ price: p, type: 'swing_high', source: 'swing_h1', strength: 2 })
  }
  for (const p of dedupe(swingLows).slice(-4)) {
    levels.push({ price: p, type: 'swing_low', source: 'swing_h1', strength: 2 })
  }

  // ── 4. Sort by proximity to current price, remove obvious duplicates ─────
  return levels
    .filter(l => l.price > 0)
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
    .slice(0, 12) // Keep top 12 closest levels
}
