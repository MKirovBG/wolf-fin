// Wolf-Fin Analyzer — core analysis engine
// Fetches market data from MT5 bridge, computes indicators, calls LLM, parses result.

import pino from 'pino'
import { MT5Adapter } from '../adapters/mt5.js'
import { computeIndicators, computeMultiTFIndicators } from '../adapters/indicators.js'
import { fetchCalendarForDisplay } from '../adapters/calendar.js'
import { fetchForexNews } from '../adapters/finnhubNews.js'
import type { Candle, KeyLevel as AdapterKeyLevel } from '../adapters/types.js'
import { getLLMProvider, getModelForConfig } from '../llm/index.js'
import { buildAnalysisPrompt, buildSystemPrompt } from './prompt.js'
import { validateProposal } from './validate.js'
import { dbSaveAnalysis, dbSetLastAnalysisAt, dbGetSymbol, dbGetStrategy, dbCreateOutcome, dbSaveFeatures, dbSaveMarketState, dbSaveCandidates, dbGetAlertRules, dbFireAlert } from '../db/index.js'
import { logEvent } from '../server/state.js'
import { buildSessionContext } from '../adapters/session.js'
import { detectPatterns } from '../adapters/patterns.js'
import { computeFeatures } from '../features/index.js'
import { classifyMarketState } from '../state/marketState.js'
import { runDetectors } from '../detectors/index.js'
import { scoreCandidates } from '../scoring/index.js'
import { resolveStrategyDefinition } from '../strategies/resolver.js'
import type { WatchSymbol, AnalysisResult, KeyLevel, TradeProposal, CandleBar, AnalysisContext } from '../types.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// Prevent concurrent analysis runs for the same symbol
const analysisInFlight = new Set<string>()

// ── Candle conversion ─────────────────────────────────────────────────────────
// Bridge candles use millisecond openTime; TradingView chart needs seconds.

function toChartCandles(candles: Candle[]): CandleBar[] {
  return candles.map(c => ({
    time:   Math.floor(c.openTime / 1000),
    open:   c.open,
    high:   c.high,
    low:    c.low,
    close:  c.close,
    volume: c.volume,
  }))
}

// ── Timeframe selector ────────────────────────────────────────────────────────

function selectCandles(
  allCandles: { m1: Candle[]; m5: Candle[]; m15: Candle[]; m30: Candle[]; h1: Candle[]; h4: Candle[] },
  tf: string,
): Candle[] {
  switch (tf) {
    case 'm1':  return allCandles.m1
    case 'm5':  return allCandles.m5
    case 'm15': return allCandles.m15
    case 'm30': return allCandles.m30
    case 'h4':  return allCandles.h4
    default:    return allCandles.h1  // default to H1
  }
}

// ── JSON extractor ────────────────────────────────────────────────────────────

function extractJSON(text: string): string | null {
  // Try ```json ... ``` block first
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (fenced) return fenced[1]
  // Fallback: first { ... } block
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1)
  return null
}

// ── Key level mapping (bridge computed levels → canonical type) ──────────────

type RawKeyLevel = { price: number; type: string; strength: number | string; source?: string; label?: string }

function mapKeyLevels(raw: RawKeyLevel[]): KeyLevel[] {
  return raw.map(l => {
    const s = l.strength
    const strength: KeyLevel['strength'] =
      s === 'strong' || s === 3 ? 'strong'
      : s === 'weak' || s === 1 ? 'weak'
      : 'moderate'
    const type: KeyLevel['type'] =
      l.type === 'swing_high' ? 'resistance'
      : l.type === 'swing_low' ? 'support'
      : (['support', 'resistance', 'pivot'].includes(l.type) ? l.type : 'pivot') as KeyLevel['type']
    return { price: l.price, type, strength, label: l.label ?? l.source ?? l.type }
  })
}

// ── Main analysis runner ──────────────────────────────────────────────────────

export async function runAnalysis(symbolKey: string): Promise<AnalysisResult> {
  if (analysisInFlight.has(symbolKey)) {
    throw new Error(`Analysis already running for ${symbolKey}`)
  }

  const sym = dbGetSymbol(symbolKey)
  if (!sym) throw new Error(`Symbol ${symbolKey} not found`)

  analysisInFlight.add(symbolKey)
  const startTime = Date.now()

  try {
    logEvent(symbolKey, 'info', 'analysis_start', `Starting analysis for ${sym.symbol}`)

    // ── 1. Fetch market data from MT5 bridge ───────────────────────────────────
    const adapter = new MT5Adapter(sym.mt5AccountId)
    const data = await adapter.fetchAnalysisData(sym.symbol)

    const primaryTf = sym.candleConfig?.primaryTimeframe ?? 'h1'
    const primaryCandles = selectCandles(data.candles, primaryTf)
    const limit = sym.candleConfig?.limit ?? 100
    const candleSlice = primaryCandles.slice(-limit)

    if (candleSlice.length < 20) {
      throw new Error(`Insufficient candle data: only ${candleSlice.length} bars for ${primaryTf}`)
    }

    // ── 2. Compute indicators ─────────────────────────────────────────────────
    const indicatorCfg = sym.indicatorConfig ?? {}
    const indicators = {
      ...computeIndicators(candleSlice, indicatorCfg),
      ...(indicatorCfg.mtfEnabled !== false ? {
        mtf: computeMultiTFIndicators(
          data.candles.m15.slice(-100),
          data.candles.h1.slice(-100),
          data.candles.h4.slice(-100),
          indicatorCfg,
        ),
      } : {}),
    }

    // ── 3. Fetch market context ───────────────────────────────────────────────
    const ctxCfg = sym.contextConfig ?? {}
    const context: AnalysisContext = {
      currentPrice: data.price,
      symbolInfo: data.symbolInfo,
    }

    if (ctxCfg.forexNews !== false) {
      try {
        const news = await fetchForexNews(sym.symbol)
        if (news.length > 0) {
          context.news = news.slice(0, 5).map(n => ({
            headline: n.headline,
            sentiment: n.sentiment,
            url: n.url,
          }))
        }
      } catch { /* news is optional */ }
    }

    if (ctxCfg.economicCalendar !== false) {
      try {
        const cal = await fetchCalendarForDisplay()
        if (cal.length > 0) {
          context.calendar = cal.slice(0, 8).map(e => ({
            time:    new Date(e.time).toISOString(),
            event:   e.name,
            impact:  e.impact,
            country: e.country,
          }))
        }
      } catch { /* calendar is optional */ }
    }

    // ── Session context ────────────────────────────────────────────────────────
    const sessionCtx = buildSessionContext(sym.symbol)
    context.session = {
      activeSessions:    sessionCtx.activeSessions,
      isLondonNYOverlap: sessionCtx.isLondonNYOverlap,
      isOptimalSession:  sessionCtx.isOptimalSession,
      note:              sessionCtx.note,
    }

    // ── Candlestick pattern detection ─────────────────────────────────────────
    const patterns = indicatorCfg.patternsEnabled !== false
      ? detectPatterns(candleSlice, data.symbolInfo.digits)
      : []

    // ── 3b. Feature engine + market-state classifier ──────────────────────────
    // Compute a typed FeatureSnapshot from indicators + context, then classify
    // the market state. Both are passed to the prompt builder and persisted
    // after the analysis ID is known.
    const features = computeFeatures({
      symbolKey,
      symbol:       sym.symbol,
      candles:      candleSlice,
      indicators,
      context,
      keyLevels:    [],   // bridge key levels available in full snapshot; empty for now
      point:        data.symbolInfo.point,
      indicatorCfg: { emaFast: indicatorCfg.emaFast, emaSlow: indicatorCfg.emaSlow },
    })
    const marketState = classifyMarketState(features)

    logEvent(symbolKey, 'info', 'features_computed',
      `State: ${marketState.regime} / ${marketState.direction} (${marketState.directionStrength}%) | Vol: ${marketState.volatility} | Session: ${marketState.sessionQuality}`)

    // ── 3c. Detectors + scoring ───────────────────────────────────────────────
    const strategyDef = resolveStrategyDefinition(sym.strategy)
    const rawCandidates = runDetectors({
      candles:    candleSlice,
      indicators,
      features,
      marketState,
      price:      data.price,
      point:      data.symbolInfo.point,
      digits:     data.symbolInfo.digits,
      strategy:   strategyDef,
    }, strategyDef?.allowedDetectors)
    const candidates = scoreCandidates(rawCandidates, features, marketState, strategyDef)

    const validCandidates = candidates.filter(c => c.found && c.tier === 'valid')
    const topCandidate    = validCandidates[0]
    logEvent(symbolKey, 'info', 'detectors_run',
      `Detectors: ${validCandidates.length} valid | top: ${topCandidate ? `${topCandidate.detector} score=${topCandidate.score}` : 'none'}`)

    // ── 4. Build prompt & call LLM ────────────────────────────────────────────
    const provider  = getLLMProvider(sym)
    const model     = getModelForConfig(sym)
    const providerName = sym.llmProvider ?? process.env.PLATFORM_LLM_PROVIDER ?? 'anthropic'

    logEvent(symbolKey, 'info', 'llm_request', `Calling LLM (${providerName} / ${model})`)

    const userMessage = buildAnalysisPrompt({
      symbol:        sym.symbol,
      timeframe:     primaryTf,
      price:         data.price,
      candles:       candleSlice,
      allCandles:    data.candles,
      indicators,
      context,
      patterns,
      indicatorCfg:  { emaFast: indicatorCfg.emaFast, emaSlow: indicatorCfg.emaSlow },
      digits:        data.symbolInfo.digits,
      features,
      marketState,
      topCandidates: validCandidates.slice(0, 3),
    })

    const stratRow = sym.strategy ? dbGetStrategy(sym.strategy) : null
    const response = await provider.createMessage({
      model,
      max_tokens: 2048,
      system: buildSystemPrompt({ strategyInstructions: stratRow?.instructions, customPrompt: sym.systemPrompt }),
      messages: [{ role: 'user', content: userMessage }],
    })

    // ── 5. Extract text response + optional thinking block ───────────────────
    const textContent    = response.content.find(c => c.type === 'text')
    const thinkingContent = response.content.find(c => (c as { type: string }).type === 'thinking')
    const rawText     = textContent     && 'text'     in textContent     ? textContent.text         : ''
    const rawThinking = thinkingContent && 'thinking' in thinkingContent ? (thinkingContent as { thinking: string }).thinking : undefined

    logEvent(symbolKey, 'info', 'llm_response', `LLM responded (${response.usage.output_tokens} tokens)`, {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    })

    // ── 6. Parse JSON from response ───────────────────────────────────────────
    const jsonStr = extractJSON(rawText)
    if (!jsonStr) {
      throw new Error(`No JSON block found in LLM response. Raw: ${rawText.slice(0, 300)}`)
    }

    let parsed: {
      bias?: string
      summary?: string
      keyLevels?: unknown[]
      tradeProposal?: unknown
    }
    try {
      parsed = JSON.parse(jsonStr) as typeof parsed
    } catch (e) {
      throw new Error(`Failed to parse LLM JSON: ${String(e)}. Raw: ${jsonStr.slice(0, 300)}`)
    }

    // ── 7. Build result ───────────────────────────────────────────────────────
    const bias = (['bullish', 'bearish', 'neutral'].includes(parsed.bias ?? ''))
      ? parsed.bias as 'bullish' | 'bearish' | 'neutral'
      : 'neutral'

    const keyLevels = mapKeyLevels((parsed.keyLevels ?? []) as RawKeyLevel[])

    let tradeProposal: TradeProposal | null = null
    if (parsed.tradeProposal && typeof parsed.tradeProposal === 'object') {
      const tp = parsed.tradeProposal as Record<string, unknown>
      tradeProposal = {
        direction:    tp.direction as 'BUY' | 'SELL' | null,
        entryZone:    (tp.entryZone as { low: number; high: number }) ?? { low: 0, high: 0 },
        stopLoss:     Number(tp.stopLoss ?? 0),
        takeProfits:  Array.isArray(tp.takeProfits) ? (tp.takeProfits as number[]).map(Number) : [],
        riskReward:   Number(tp.riskReward ?? 0),
        reasoning:    String(tp.reasoning ?? ''),
        confidence:   (['high', 'medium', 'low'].includes(String(tp.confidence)) ? tp.confidence : 'medium') as 'high' | 'medium' | 'low',
        invalidatedIf: tp.invalidatedIf ? String(tp.invalidatedIf) : undefined,
      }
    }

    // Flatten indicators to a simple Record<string, number|string> for storage
    const indicatorsFlat: Record<string, number | string> = {}
    // Scalars
    if (indicators.rsi14   != null) indicatorsFlat['RSI(14)']   = +indicators.rsi14.toFixed(2)
    if (indicators.ema20   != null) indicatorsFlat['EMA Fast']  = +indicators.ema20.toFixed(5)
    if (indicators.ema50   != null) indicatorsFlat['EMA Slow']  = +indicators.ema50.toFixed(5)
    if (indicators.atr14   != null) indicatorsFlat['ATR(14)']   = +indicators.atr14.toFixed(5)
    if (indicators.vwap    != null) indicatorsFlat['VWAP']      = +indicators.vwap.toFixed(5)
    if (indicators.bbWidth != null) indicatorsFlat['BB Width']  = +indicators.bbWidth.toFixed(5)
    if (indicators.cci     != null) indicatorsFlat['CCI(20)']   = +indicators.cci.toFixed(2)
    if (indicators.williamsR != null) indicatorsFlat['Williams %R'] = +indicators.williamsR.toFixed(2)
    if (indicators.mfi     != null) indicatorsFlat['MFI(14)']   = +indicators.mfi.toFixed(2)
    // Compound
    if (indicators.macd) {
      indicatorsFlat['MACD']        = +indicators.macd.macd.toFixed(5)
      indicatorsFlat['MACD Signal'] = +indicators.macd.signal.toFixed(5)
      indicatorsFlat['MACD Hist']   = +indicators.macd.histogram.toFixed(5)
    }
    if (indicators.adx) {
      indicatorsFlat['ADX(14)'] = +indicators.adx.adx.toFixed(2)
      indicatorsFlat['+DI']     = +indicators.adx.plusDI.toFixed(2)
      indicatorsFlat['-DI']     = +indicators.adx.minusDI.toFixed(2)
    }
    if (indicators.stoch) {
      indicatorsFlat['Stoch %K'] = +indicators.stoch.k.toFixed(2)
      indicatorsFlat['Stoch %D'] = +indicators.stoch.d.toFixed(2)
    }
    if (indicators.psar) {
      indicatorsFlat['PSAR']         = +indicators.psar.value.toFixed(5)
      indicatorsFlat['PSAR Trend']   = indicators.psar.bullish ? 'Bullish' : 'Bearish'
    }
    if (indicators.obv) {
      indicatorsFlat['OBV']      = +indicators.obv.value.toFixed(0)
      indicatorsFlat['OBV Bias'] = indicators.obv.rising ? 'Rising' : 'Falling'
    }
    if (indicators.keltner) {
      indicatorsFlat['Keltner Upper']  = +indicators.keltner.upper.toFixed(5)
      indicatorsFlat['Keltner Mid']    = +indicators.keltner.middle.toFixed(5)
      indicatorsFlat['Keltner Lower']  = +indicators.keltner.lower.toFixed(5)
    }
    if (indicators.ichimoku) {
      indicatorsFlat['Ichi Conversion'] = +indicators.ichimoku.conversion.toFixed(5)
      indicatorsFlat['Ichi Base']       = +indicators.ichimoku.base.toFixed(5)
      indicatorsFlat['Ichi Cloud']      = indicators.ichimoku.cloudBullish ? 'Bullish' : 'Bearish'
      indicatorsFlat['Ichi Position']   = indicators.ichimoku.aboveCloud ? 'Above' : 'Below'
    }
    // Multi-timeframe
    if (indicators.mtf) {
      if (indicators.mtf.confluence != null) indicatorsFlat['MTF Score']  = indicators.mtf.confluence
      if (indicators.mtf.m15?.rsi14  != null) indicatorsFlat['M15 RSI']   = +indicators.mtf.m15.rsi14.toFixed(2)
      if (indicators.mtf.m15?.ema20  != null) indicatorsFlat['M15 EMA20'] = +indicators.mtf.m15.ema20.toFixed(5)
      if (indicators.mtf.h4?.rsi14   != null) indicatorsFlat['H4 RSI']    = +indicators.mtf.h4.rsi14.toFixed(2)
      if (indicators.mtf.h4?.ema20   != null) indicatorsFlat['H4 EMA20']  = +indicators.mtf.h4.ema20.toFixed(5)
      if (indicators.mtf.h4?.ema50   != null) indicatorsFlat['H4 EMA50']  = +indicators.mtf.h4.ema50.toFixed(5)
    }

    // Strip NaN values — JSON.stringify turns NaN → null which pollutes the DB
    for (const k of Object.keys(indicatorsFlat)) {
      const v = indicatorsFlat[k]
      if (typeof v === 'number' && isNaN(v)) delete indicatorsFlat[k]
    }

    // ── Proposal validation ────────────────────────────────────────────────────
    let validation = undefined
    if (tradeProposal && tradeProposal.direction) {
      const atrVal = indicators.atr14 ?? 0
      const mtfScore = indicators.mtf?.confluence
      validation = validateProposal({
        proposal:  tradeProposal,
        keyLevels,
        atr:       atrVal,
        bias,
        mtfScore,
      })
    }

    const now = new Date().toISOString()
    const elapsed = Date.now() - startTime

    const result: Omit<AnalysisResult, 'id'> = {
      symbolKey,
      symbol:        sym.symbol,
      market:        'mt5',
      timeframe:     primaryTf,
      time:          now,
      bias,
      summary:       String(parsed.summary ?? ''),
      keyLevels,
      tradeProposal,
      indicators:    indicatorsFlat,
      candles:       toChartCandles(candleSlice),
      context,
      patterns:      patterns.length > 0 ? patterns : undefined,
      validation,
      llmProvider:   providerName,
      llmModel:      model,
      rawResponse:   rawText,
      llmThinking:   rawThinking,
    }

    const id = dbSaveAnalysis(result)
    dbSetLastAnalysisAt(symbolKey, now)

    // ── Persist features, market state, setup candidates ─────────────────────
    try {
      dbSaveFeatures({ ...features, analysisId: id }, id)
      dbSaveMarketState({ ...marketState, analysisId: id }, id)
      dbSaveCandidates(candidates.map(c => ({ ...c, analysisId: id })), id)
    } catch (e) {
      log.warn({ err: String(e) }, 'failed to persist features/state/candidates')
    }

    // ── Evaluate alert rules ──────────────────────────────────────────────────
    try {
      const rules = dbGetAlertRules(symbolKey).filter(r => r.enabled)
      for (const rule of rules) {
        let fired = false
        let msg = ''
        if (rule.conditionType === 'setup_score_gte') {
          const threshold = parseInt(rule.conditionValue, 10)
          const topValid = validCandidates[0]
          if (topValid && topValid.score >= threshold) {
            fired = true
            msg = `Setup alert: ${topValid.setupType} scored ${topValid.score} (threshold ${threshold})`
          }
        } else if (rule.conditionType === 'regime_change') {
          if (marketState.regime === rule.conditionValue) {
            fired = true
            msg = `Regime changed to ${marketState.regime}`
          }
        } else if (rule.conditionType === 'direction_change') {
          if (marketState.direction === rule.conditionValue) {
            fired = true
            msg = `Direction: ${marketState.direction}`
          }
        } else if (rule.conditionType === 'context_risk_gte') {
          const riskOrder = ['low', 'moderate', 'elevated', 'avoid']
          const ruleIdx   = riskOrder.indexOf(rule.conditionValue)
          const currIdx   = riskOrder.indexOf(marketState.contextRisk)
          if (currIdx >= ruleIdx && ruleIdx >= 0) {
            fired = true
            msg = `Context risk: ${marketState.contextRisk}`
          }
        }
        if (fired) {
          dbFireAlert(rule.id!, symbolKey, msg, id)
          logEvent(symbolKey, 'info', 'detectors_run', `Alert fired: ${rule.name} — ${msg}`)
        }
      }
    } catch (e) {
      log.warn({ err: String(e) }, 'alert evaluation failed')
    }

    // ── Create outcome tracking record if a trade was proposed ────────────────
    if (tradeProposal && tradeProposal.direction) {
      const tps = tradeProposal.takeProfits ?? []
      dbCreateOutcome({
        analysisId: id,
        symbolKey,
        direction:  tradeProposal.direction,
        entryLow:   tradeProposal.entryZone.low,
        entryHigh:  tradeProposal.entryZone.high,
        sl:         tradeProposal.stopLoss,
        tp1:        tps[0] ?? null,
        tp2:        tps[1] ?? null,
        tp3:        tps[2] ?? null,
        status:     'pending',
        createdAt:  now,
      })
    }

    logEvent(symbolKey, 'info', 'analysis_end', `Analysis complete in ${elapsed}ms — ${bias} bias`, {
      bias, keyLevels: keyLevels.length, hasProposal: !!tradeProposal,
    })
    log.info({ symbolKey, bias, elapsed }, 'analysis complete')

    return { ...result, id }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error({ symbolKey, err: msg }, 'analysis failed')
    logEvent(symbolKey, 'error', 'analysis_error', `Analysis failed: ${msg}`)

    // Save error record to DB so UI can show it
    const errorResult: Omit<AnalysisResult, 'id'> = {
      symbolKey,
      symbol:      sym?.symbol ?? symbolKey,
      market:      'mt5',
      timeframe:   sym?.candleConfig?.primaryTimeframe ?? 'h1',
      time:        new Date().toISOString(),
      bias:        'neutral',
      summary:     '',
      keyLevels:   [],
      tradeProposal: null,
      indicators:  {},
      candles:     [],
      context:     {},
      llmProvider: sym?.llmProvider ?? 'unknown',
      llmModel:    sym?.llmModel ?? 'unknown',
      error:       msg,
    }
    const id = dbSaveAnalysis(errorResult)
    return { ...errorResult, id }

  } finally {
    analysisInFlight.delete(symbolKey)
  }
}

export function isAnalysisRunning(symbolKey: string): boolean {
  return analysisInFlight.has(symbolKey)
}
