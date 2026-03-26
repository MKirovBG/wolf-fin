// Wolf-Fin — GBDT-style indicator ensemble confidence scorer
// Aggregates available indicator votes to produce a directional confidence signal.
// Each indicator casts a +1 (bullish) / -1 (bearish) / 0 (neutral/absent) vote.
// The final score mirrors the kind of feature-weighted ensemble that a gradient-boosted
// decision tree would learn from labelled trade data — without requiring training data.

import type { Indicators } from './types.js'

export interface MLSignalResult {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  confidence: number          // 0–100 (percentage of active votes that agree with direction)
  score: number               // raw sum of votes (positive = bullish)
  bullishCount: number
  bearishCount: number
  neutralCount: number
  totalActive: number
  bullishFactors: string[]    // human-readable list of supporting bullish indicators
  bearishFactors: string[]    // human-readable list of supporting bearish indicators
}

interface Vote {
  label: string
  value: number  // +1 | -1 | 0
}

export function computeMLSignal(
  indicators: Partial<Indicators> & { vwap?: number },
  currentPrice?: number,
): MLSignalResult {
  const votes: Vote[] = []

  // ── RSI ──────────────────────────────────────────────────────────────────────
  if (indicators.rsi14 != null) {
    const rsi = indicators.rsi14
    if (rsi >= 60)      votes.push({ label: 'RSI momentum (bullish)', value: +1 })
    else if (rsi <= 40) votes.push({ label: 'RSI momentum (bearish)', value: -1 })
    else                votes.push({ label: 'RSI neutral', value: 0 })
  }

  // ── EMA cross ────────────────────────────────────────────────────────────────
  if (indicators.ema20 != null && indicators.ema50 != null) {
    if (indicators.ema20 > indicators.ema50)
      votes.push({ label: 'EMA cross (bullish trend)', value: +1 })
    else
      votes.push({ label: 'EMA cross (bearish trend)', value: -1 })
  }

  // ── VWAP position ────────────────────────────────────────────────────────────
  if (currentPrice != null && indicators.vwap != null && indicators.vwap > 0) {
    if (currentPrice > indicators.vwap)
      votes.push({ label: 'price above VWAP', value: +1 })
    else
      votes.push({ label: 'price below VWAP', value: -1 })
  }

  // ── MACD histogram ───────────────────────────────────────────────────────────
  if (indicators.macd != null) {
    const hist = indicators.macd.histogram
    if (hist > 0)      votes.push({ label: 'MACD histogram (bullish)', value: +1 })
    else if (hist < 0) votes.push({ label: 'MACD histogram (bearish)', value: -1 })
    else               votes.push({ label: 'MACD histogram (flat)', value: 0 })
  }

  // ── ADX directional ──────────────────────────────────────────────────────────
  if (indicators.adx != null && indicators.adx.adx >= 20) {
    // Only vote when ADX shows meaningful trend strength
    const { plusDI, minusDI } = indicators.adx
    if (plusDI > minusDI)      votes.push({ label: 'ADX +DI dominant (bullish)', value: +1 })
    else if (minusDI > plusDI) votes.push({ label: 'ADX -DI dominant (bearish)', value: -1 })
    else                       votes.push({ label: 'ADX DI balanced', value: 0 })
  }

  // ── Stochastic %K ────────────────────────────────────────────────────────────
  if (indicators.stoch != null) {
    const k = indicators.stoch.k
    if (k <= 20)      votes.push({ label: 'Stochastic oversold (bullish)', value: +1 })
    else if (k >= 80) votes.push({ label: 'Stochastic overbought (bearish)', value: -1 })
    // Between 20-80: no vote (neutral zone)
  }

  // ── Parabolic SAR ────────────────────────────────────────────────────────────
  if (indicators.psar != null) {
    if (indicators.psar.bullish)  votes.push({ label: 'PSAR bullish (SAR below)', value: +1 })
    else                          votes.push({ label: 'PSAR bearish (SAR above)', value: -1 })
  }

  // ── Ichimoku Cloud ───────────────────────────────────────────────────────────
  if (indicators.ichimoku != null) {
    const ichi = indicators.ichimoku
    if (ichi.aboveCloud && ichi.cloudBullish)
      votes.push({ label: 'Ichimoku: above bullish cloud', value: +1 })
    else if (!ichi.aboveCloud && !ichi.cloudBullish)
      votes.push({ label: 'Ichimoku: below bearish cloud', value: -1 })
    else
      votes.push({ label: 'Ichimoku: mixed signal', value: 0 })
  }

  // ── CCI ──────────────────────────────────────────────────────────────────────
  if (indicators.cci != null) {
    if (indicators.cci > 100)       votes.push({ label: 'CCI overbought thrust (bullish)', value: +1 })
    else if (indicators.cci < -100) votes.push({ label: 'CCI oversold thrust (bearish)', value: -1 })
    else if (indicators.cci > 0)    votes.push({ label: 'CCI positive (mild bullish)', value: +1 })
    else                            votes.push({ label: 'CCI negative (mild bearish)', value: -1 })
  }

  // ── Williams %R ──────────────────────────────────────────────────────────────
  if (indicators.williamsR != null) {
    const wr = indicators.williamsR
    if (wr < -80)      votes.push({ label: 'Williams %R oversold (bullish)', value: +1 })
    else if (wr > -20) votes.push({ label: 'Williams %R overbought (bearish)', value: -1 })
    // -80 to -20: no vote
  }

  // ── OBV direction ────────────────────────────────────────────────────────────
  if (indicators.obv != null) {
    if (indicators.obv.rising)  votes.push({ label: 'OBV rising (buying pressure)', value: +1 })
    else                        votes.push({ label: 'OBV falling (selling pressure)', value: -1 })
  }

  // ── MFI ──────────────────────────────────────────────────────────────────────
  if (indicators.mfi != null) {
    const mfi = indicators.mfi
    if (mfi <= 20)      votes.push({ label: 'MFI oversold (bullish money flow)', value: +1 })
    else if (mfi >= 80) votes.push({ label: 'MFI overbought (bearish money flow)', value: -1 })
    else if (mfi > 50)  votes.push({ label: 'MFI bullish flow', value: +1 })
    else                votes.push({ label: 'MFI bearish flow', value: -1 })
  }

  // ── MTF confluence ───────────────────────────────────────────────────────────
  if (indicators.mtf != null) {
    const c = indicators.mtf.confluence
    if (c >= 2)       votes.push({ label: 'MTF confluence strong bullish', value: +1 })
    else if (c <= -2) votes.push({ label: 'MTF confluence strong bearish', value: -1 })
    else if (c > 0)   votes.push({ label: 'MTF lean bullish', value: +1 })
    else if (c < 0)   votes.push({ label: 'MTF lean bearish', value: -1 })
  }

  // ── Keltner Channel position ─────────────────────────────────────────────────
  if (indicators.keltner != null && currentPrice != null) {
    const { upper, lower } = indicators.keltner
    if (currentPrice > upper)      votes.push({ label: 'Keltner breakout above (bullish)', value: +1 })
    else if (currentPrice < lower) votes.push({ label: 'Keltner breakdown below (bearish)', value: -1 })
    // inside channel: no vote
  }

  // ── Tally ────────────────────────────────────────────────────────────────────
  const bullishFactors = votes.filter(v => v.value > 0).map(v => v.label)
  const bearishFactors = votes.filter(v => v.value < 0).map(v => v.label)
  const neutralCount   = votes.filter(v => v.value === 0).length

  const bullishCount = bullishFactors.length
  const bearishCount = bearishFactors.length
  const totalActive  = bullishCount + bearishCount  // excluding neutral
  const score        = bullishCount - bearishCount

  let direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  let confidence: number

  if (totalActive === 0) {
    direction  = 'NEUTRAL'
    confidence = 0
  } else {
    const majorityCount = Math.max(bullishCount, bearishCount)
    confidence = Math.round((majorityCount / totalActive) * 100)

    if (score > 0 && confidence >= 55)       direction = 'LONG'
    else if (score < 0 && confidence >= 55)  direction = 'SHORT'
    else                                     direction = 'NEUTRAL'
  }

  return {
    direction,
    confidence,
    score,
    bullishCount,
    bearishCount,
    neutralCount,
    totalActive,
    bullishFactors,
    bearishFactors,
  }
}

/** Formats the ML signal as a text block for injection into the LLM prompt */
export function formatMLSignalBlock(result: MLSignalResult): string {
  const lines: string[] = []

  const dirEmoji = result.direction === 'LONG' ? '📈' : result.direction === 'SHORT' ? '📉' : '➖'
  lines.push(`INDICATOR ENSEMBLE SIGNAL (GBDT-style):`)
  lines.push(`  ${dirEmoji} Direction: ${result.direction} | Confidence: ${result.confidence}% (${Math.max(result.bullishCount, result.bearishCount)}/${result.totalActive} active indicators agree)`)

  if (result.bullishFactors.length > 0) {
    lines.push(`  Bullish: ${result.bullishFactors.join(', ')}`)
  }
  if (result.bearishFactors.length > 0) {
    lines.push(`  Bearish: ${result.bearishFactors.join(', ')}`)
  }
  if (result.neutralCount > 0) {
    lines.push(`  Neutral/absent: ${result.neutralCount} indicator(s)`)
  }
  lines.push(`  ↳ This score aggregates all enabled indicators. Treat as a secondary confirmation, not a standalone signal.`)

  return lines.join('\n')
}
