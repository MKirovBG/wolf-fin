// Wolf-Fin Analyzer — prompt builder
// Assembles the structured analysis prompt from candle data, indicators, and context.

import type { Candle, Indicators } from '../adapters/types.js'
import type { AnalysisContext, CandlePattern, CandleConfig } from '../types.js'

const TIMEFRAME_LABELS: Record<string, string> = {
  m1: '1-Minute', m5: '5-Minute', m15: '15-Minute',
  m30: '30-Minute', h1: '1-Hour', h4: '4-Hour',
}

function fmt(n: number, digits = 5): string {
  return n.toFixed(digits)
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

function candleTable(candles: Candle[], limit = 50): string {
  const slice = candles.slice(-limit)
  const rows = slice.map(c => {
    const t = new Date(c.openTime).toISOString().replace('T', ' ').slice(0, 16)
    const dir = c.close >= c.open ? '▲' : '▼'
    return `${t}  O:${fmt(c.open)}  H:${fmt(c.high)}  L:${fmt(c.low)}  C:${fmt(c.close)}  V:${c.volume.toFixed(2)} ${dir}`
  })
  return rows.join('\n')
}

function indicatorBlock(ind: Indicators, cfg: { emaFast?: number; emaSlow?: number } = {}): string {
  const lines: string[] = []
  const emaFast = cfg.emaFast ?? 20
  const emaSlow = cfg.emaSlow ?? 50

  if (ind.rsi14 != null)   lines.push(`RSI(14):          ${ind.rsi14.toFixed(2)}`)
  if (ind.ema20 != null)   lines.push(`EMA(${String(emaFast).padEnd(2)}):          ${fmt(ind.ema20)}`)
  if (ind.ema50 != null)   lines.push(`EMA(${String(emaSlow).padEnd(2)}):          ${fmt(ind.ema50)}`)
  if (ind.atr14 != null)   lines.push(`ATR(14):          ${fmt(ind.atr14)}`)
  if (ind.vwap)            lines.push(`VWAP:             ${fmt(ind.vwap)}`)
  if (ind.bbWidth != null) lines.push(`BB Width:         ${(ind.bbWidth * 100).toFixed(3)}%`)

  if (ind.macd) {
    lines.push(`MACD:             ${ind.macd.macd.toFixed(5)}  Signal: ${ind.macd.signal.toFixed(5)}  Hist: ${ind.macd.histogram.toFixed(5)}`)
  }
  if (ind.adx) {
    lines.push(`ADX(14):          ${ind.adx.adx.toFixed(2)}  +DI: ${ind.adx.plusDI.toFixed(2)}  -DI: ${ind.adx.minusDI.toFixed(2)}`)
  }
  if (ind.stoch) {
    lines.push(`Stochastic:       K: ${ind.stoch.k.toFixed(2)}  D: ${ind.stoch.d.toFixed(2)}`)
  }
  if (ind.psar) {
    lines.push(`Parabolic SAR:    ${fmt(ind.psar.value)}  (${ind.psar.bullish ? 'Bullish' : 'Bearish'})`)
  }
  if (ind.cci != null) {
    lines.push(`CCI(20):          ${ind.cci.toFixed(2)}`)
  }
  if (ind.williamsR != null) {
    lines.push(`Williams %R(14):  ${ind.williamsR.toFixed(2)}`)
  }
  if (ind.mfi != null) {
    lines.push(`MFI(14):          ${ind.mfi.toFixed(2)}`)
  }
  if (ind.obv) {
    lines.push(`OBV:              ${ind.obv.value.toFixed(0)}  (${ind.obv.rising ? 'Rising' : 'Falling'})`)
  }
  if (ind.keltner) {
    lines.push(`Keltner:          Upper: ${fmt(ind.keltner.upper)}  Mid: ${fmt(ind.keltner.middle)}  Lower: ${fmt(ind.keltner.lower)}`)
  }
  if (ind.ichimoku) {
    lines.push(`Ichimoku:         Conv: ${fmt(ind.ichimoku.conversion)}  Base: ${fmt(ind.ichimoku.base)}  SpanA: ${fmt(ind.ichimoku.spanA)}  SpanB: ${fmt(ind.ichimoku.spanB)}`)
    lines.push(`                  ${ind.ichimoku.aboveCloud ? 'Price ABOVE cloud' : 'Price BELOW cloud'}  Cloud: ${ind.ichimoku.cloudBullish ? 'Bullish' : 'Bearish'}`)
  }

  if (ind.mtf) {
    lines.push('')
    lines.push('Multi-Timeframe Confluence:')
    if (ind.mtf.m15) {
      lines.push(`  M15 — RSI: ${ind.mtf.m15.rsi14.toFixed(1)}  EMA20: ${fmt(ind.mtf.m15.ema20)}  ATR: ${fmt(ind.mtf.m15.atr14)}`)
    }
    if (ind.mtf.h4) {
      lines.push(`  H4  — RSI: ${ind.mtf.h4.rsi14.toFixed(1)}  EMA20: ${fmt(ind.mtf.h4.ema20)}${ind.mtf.h4.ema50 != null ? `  EMA50: ${fmt(ind.mtf.h4.ema50)}` : ''}`)
    }
    lines.push(`  Score: ${ind.mtf.confluence > 0 ? '+' : ''}${ind.mtf.confluence}/3 (${ind.mtf.confluence > 1 ? 'Bullish' : ind.mtf.confluence < -1 ? 'Bearish' : 'Neutral'})`)
  }

  if (ind.divergence) {
    lines.push('')
    lines.push('Divergence:')
    if (ind.divergence.rsi)  lines.push(`  RSI:  ${ind.divergence.rsi.toUpperCase()} divergence detected`)
    if (ind.divergence.macd) lines.push(`  MACD: ${ind.divergence.macd.toUpperCase()} divergence detected`)
  }

  if (ind.fib && ind.fib.length > 0) {
    lines.push('')
    lines.push('Fibonacci Levels (swing):')
    for (const f of ind.fib) {
      lines.push(`  ${f.label.padEnd(14)} ${fmt(f.price)}`)
    }
  }

  return lines.join('\n')
}

// ── Multi-TF overview ─────────────────────────────────────────────────────────
// Shows a one-line summary per timeframe so the LLM understands the broader
// market context even when the primary timeframe is M5/M15/M30.

const TF_ORDER = ['m1', 'm5', 'm15', 'm30', 'h1', 'h4'] as const
const TF_LABEL: Record<string, string> = {
  m1: 'M1', m5: 'M5', m15: 'M15', m30: 'M30', h1: 'H1', h4: 'H4',
}

function tfSummaryLine(tf: string, candles: Candle[], digits: number): string | null {
  if (candles.length < 3) return null
  const last  = candles[candles.length - 1]
  const prev  = candles[candles.length - 2]
  const prev2 = candles[candles.length - 3]

  const dir     = last.close >= last.open ? '▲' : '▼'
  const change  = ((last.close - prev.close) / prev.close) * 100
  const chgStr  = (change >= 0 ? '+' : '') + change.toFixed(3) + '%'

  // Simple trend: last 3 closes rising/falling
  const trend   = last.close > prev.close && prev.close > prev2.close ? 'Up'
                : last.close < prev.close && prev.close < prev2.close ? 'Down'
                : 'Mixed'

  return `  ${TF_LABEL[tf].padEnd(4)}  Close: ${last.close.toFixed(digits)}  ${dir} ${chgStr.padStart(8)}  Trend: ${trend}  Bars: ${candles.length}`
}

function multiTfOverview(
  allCandles: Record<string, Candle[]>,
  primaryTf: string,
  digits: number,
): string {
  const lines: string[] = ['Timeframe Overview (all available bars):']
  for (const tf of TF_ORDER) {
    const candles = allCandles[tf] ?? []
    const line = tfSummaryLine(tf, candles, digits)
    if (line) {
      const marker = tf === primaryTf ? ' ← primary' : ''
      lines.push(line + marker)
    }
  }
  return lines.join('\n')
}

function patternsBlock(patterns: CandlePattern[]): string {
  if (patterns.length === 0) return ''
  const lines = ['Detected Candlestick Patterns:']
  for (const p of patterns.slice(0, 8)) {
    const dir = p.direction === 'neutral' ? '' : ` [${p.direction.toUpperCase()}]`
    lines.push(`  ${p.name}${dir} at ${fmt(p.price)} — ${p.description}`)
  }
  return lines.join('\n')
}

function contextBlock(ctx: AnalysisContext): string {
  const lines: string[] = []

  if (ctx.news && ctx.news.length > 0) {
    lines.push('Recent Forex News:')
    for (const item of ctx.news.slice(0, 5)) {
      lines.push(`  [${item.sentiment.toUpperCase()}] ${item.headline}`)
    }
  }

  if (ctx.calendar && ctx.calendar.length > 0) {
    lines.push('Upcoming Economic Events:')
    for (const ev of ctx.calendar.slice(0, 5)) {
      lines.push(`  ${ev.time}  [${ev.impact.toUpperCase()}] ${ev.country}: ${ev.event}`)
    }
  }

  if (ctx.session) {
    lines.push(`Session: ${ctx.session.note}`)
  }

  return lines.join('\n')
}

export function buildAnalysisPrompt(params: {
  symbol: string
  timeframe: string
  price: { bid: number; ask: number; mid: number; spread: number }
  candles: Candle[]
  allCandles?: Record<string, Candle[]>   // all TF candles for the overview block
  indicators: Indicators
  context: AnalysisContext
  patterns?: CandlePattern[]
  indicatorCfg?: { emaFast?: number; emaSlow?: number }
  digits?: number
}): string {
  const { symbol, timeframe, price, candles, allCandles, indicators, context, patterns = [] } = params
  const tfLabel = TIMEFRAME_LABELS[timeframe] ?? timeframe.toUpperCase()
  const digits = params.digits ?? 5

  // Last candle for quick summary
  const last = candles[candles.length - 1]
  const prev = candles[candles.length - 2]
  const change = last && prev ? fmtPct(((last.close - prev.close) / prev.close) * 100) : 'n/a'

  const ctxText      = contextBlock(context)
  const patternsText = patternsBlock(patterns)
  const mtfOverview  = allCandles ? multiTfOverview(allCandles, timeframe, digits) : null

  return `Analyze ${symbol} on the ${tfLabel} timeframe and return a structured trading analysis.

## Current Market State
Symbol:       ${symbol}
Timeframe:    ${tfLabel}
Bid:          ${price.bid.toFixed(digits)}
Ask:          ${price.ask.toFixed(digits)}
Mid:          ${price.mid.toFixed(digits)}
Spread:       ${price.spread.toFixed(1)} pips
Last bar:     O:${last?.open.toFixed(digits)} H:${last?.high.toFixed(digits)} L:${last?.low.toFixed(digits)} C:${last?.close.toFixed(digits)}  (${change})

${mtfOverview ? '\n## ' + mtfOverview + '\n' : ''}
## Technical Indicators
${indicatorBlock(indicators, params.indicatorCfg)}

## Candlestick Data (${Math.min(candles.length, 50)} bars, ${tfLabel})
${candleTable(candles, 50)}
${patternsText ? '\n## Candlestick Patterns\n' + patternsText : ''}
${ctxText ? '\n## Market Context\n' + ctxText : ''}

## Instructions
Based on the above data, provide a professional technical analysis. Identify key price levels from the chart structure (swing highs/lows, round numbers, recent support/resistance), determine the overall market bias, and if a high-probability setup exists, propose a specific trade.

Return ONLY a JSON code block in this exact format — no text before or after the block:

\`\`\`json
{
  "bias": "bullish" | "bearish" | "neutral",
  "summary": "2-3 sentences describing current conditions and what is driving price",
  "keyLevels": [
    {
      "price": <number>,
      "type": "support" | "resistance" | "pivot",
      "strength": "strong" | "moderate" | "weak",
      "label": "Brief description, e.g. 'Daily high', 'Weekly pivot', 'Demand zone'"
    }
  ],
  "tradeProposal": {
    "direction": "BUY" | "SELL",
    "entryZone": { "low": <number>, "high": <number> },
    "stopLoss": <number>,
    "takeProfits": [<tp1>, <tp2>],
    "riskReward": <number>,
    "reasoning": "Why this setup is valid — entry trigger, confluence factors",
    "confidence": "high" | "medium" | "low",
    "invalidatedIf": "What price action would cancel this setup"
  }
}
\`\`\`

If there is no clear trade setup, set "tradeProposal" to null. Always include at least 3 key levels. Prices must use the same decimal precision as the symbol (${digits} digits).`
}

export function buildSystemPrompt(options?: { strategyInstructions?: string; customPrompt?: string }): string {
  if (options?.customPrompt?.trim()) return options.customPrompt.trim()

  const base = `You are a professional forex and CFD technical analyst with expertise in price action, multi-timeframe analysis, and institutional trading concepts. Your analysis is objective, data-driven, and focused on high-probability setups. You identify key structural levels from chart history and only propose trades when there is clear confluence. You always respond with valid JSON exactly as instructed.`

  const strategyNote = options?.strategyInstructions?.trim()
    ? `\n\nAnalysis approach: ${options.strategyInstructions.trim()}`
    : ''

  return base + strategyNote
}
