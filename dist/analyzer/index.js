// Wolf-Fin Analyzer — core analysis engine
// Fetches market data from MT5 bridge, computes indicators, calls LLM, parses result.
import pino from 'pino';
import { MT5Adapter } from '../adapters/mt5.js';
import { computeIndicators, computeMultiTFIndicators } from '../adapters/indicators.js';
import { fetchCalendarForDisplay } from '../adapters/calendar.js';
import { fetchForexNews } from '../adapters/finnhubNews.js';
import { getLLMProvider, getModelForConfig } from '../llm/index.js';
import { buildAnalysisPrompt, buildSystemPrompt } from './prompt.js';
import { dbSaveAnalysis, dbSetLastAnalysisAt, dbGetSymbol } from '../db/index.js';
import { logEvent } from '../server/state.js';
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
// Prevent concurrent analysis runs for the same symbol
const analysisInFlight = new Set();
// ── Candle conversion ─────────────────────────────────────────────────────────
// Bridge candles use millisecond openTime; TradingView chart needs seconds.
function toChartCandles(candles) {
    return candles.map(c => ({
        time: Math.floor(c.openTime / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
    }));
}
// ── Timeframe selector ────────────────────────────────────────────────────────
function selectCandles(allCandles, tf) {
    switch (tf) {
        case 'm1': return allCandles.m1;
        case 'm5': return allCandles.m5;
        case 'm15': return allCandles.m15;
        case 'm30': return allCandles.m30;
        case 'h4': return allCandles.h4;
        default: return allCandles.h1; // default to H1
    }
}
// ── JSON extractor ────────────────────────────────────────────────────────────
function extractJSON(text) {
    // Try ```json ... ``` block first
    const fenced = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (fenced)
        return fenced[1];
    // Fallback: first { ... } block
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start)
        return text.slice(start, end + 1);
    return null;
}
function mapKeyLevels(raw) {
    return raw.map(l => {
        const s = l.strength;
        const strength = s === 'strong' || s === 3 ? 'strong'
            : s === 'weak' || s === 1 ? 'weak'
                : 'moderate';
        const type = l.type === 'swing_high' ? 'resistance'
            : l.type === 'swing_low' ? 'support'
                : (['support', 'resistance', 'pivot'].includes(l.type) ? l.type : 'pivot');
        return { price: l.price, type, strength, label: l.label ?? l.source ?? l.type };
    });
}
// ── Main analysis runner ──────────────────────────────────────────────────────
export async function runAnalysis(symbolKey) {
    if (analysisInFlight.has(symbolKey)) {
        throw new Error(`Analysis already running for ${symbolKey}`);
    }
    const sym = dbGetSymbol(symbolKey);
    if (!sym)
        throw new Error(`Symbol ${symbolKey} not found`);
    analysisInFlight.add(symbolKey);
    const startTime = Date.now();
    logEvent(symbolKey, 'info', 'analysis_start', `Starting analysis for ${sym.symbol}`);
    try {
        // ── 1. Fetch market data from MT5 bridge ───────────────────────────────────
        const adapter = new MT5Adapter(sym.mt5AccountId);
        const data = await adapter.fetchAnalysisData(sym.symbol);
        const primaryTf = sym.candleConfig?.primaryTimeframe ?? 'h1';
        const primaryCandles = selectCandles(data.candles, primaryTf);
        const limit = sym.candleConfig?.limit ?? 100;
        const candleSlice = primaryCandles.slice(-limit);
        if (candleSlice.length < 20) {
            throw new Error(`Insufficient candle data: only ${candleSlice.length} bars for ${primaryTf}`);
        }
        // ── 2. Compute indicators ─────────────────────────────────────────────────
        const indicatorCfg = sym.indicatorConfig ?? {};
        const indicators = {
            ...computeIndicators(candleSlice, indicatorCfg),
            ...(indicatorCfg.mtfEnabled !== false ? {
                mtf: computeMultiTFIndicators(data.candles.m15.slice(-100), data.candles.h1.slice(-100), data.candles.h4.slice(-100), indicatorCfg),
            } : {}),
        };
        // ── 3. Fetch market context ───────────────────────────────────────────────
        const ctxCfg = sym.contextConfig ?? {};
        const context = {
            currentPrice: data.price,
            symbolInfo: data.symbolInfo,
        };
        if (ctxCfg.forexNews !== false) {
            try {
                const news = await fetchForexNews(sym.symbol);
                if (news.length > 0) {
                    context.news = news.slice(0, 5).map(n => ({
                        headline: n.headline,
                        sentiment: n.sentiment,
                        url: n.url,
                    }));
                }
            }
            catch { /* news is optional */ }
        }
        if (ctxCfg.economicCalendar !== false) {
            try {
                const cal = await fetchCalendarForDisplay();
                if (cal.length > 0) {
                    context.calendar = cal.slice(0, 8).map(e => ({
                        time: new Date(e.time).toISOString(),
                        event: e.name,
                        impact: e.impact,
                        country: e.country,
                    }));
                }
            }
            catch { /* calendar is optional */ }
        }
        // ── 4. Build prompt & call LLM ────────────────────────────────────────────
        const provider = getLLMProvider(sym);
        const model = getModelForConfig(sym);
        const providerName = sym.llmProvider ?? process.env.PLATFORM_LLM_PROVIDER ?? 'anthropic';
        logEvent(symbolKey, 'info', 'llm_request', `Calling LLM (${providerName} / ${model})`);
        const userMessage = buildAnalysisPrompt({
            symbol: sym.symbol,
            timeframe: primaryTf,
            price: data.price,
            candles: candleSlice,
            indicators,
            context,
            indicatorCfg: { emaFast: indicatorCfg.emaFast, emaSlow: indicatorCfg.emaSlow },
            digits: data.symbolInfo.digits,
        });
        const response = await provider.createMessage({
            model,
            max_tokens: 2048,
            system: buildSystemPrompt(),
            messages: [{ role: 'user', content: userMessage }],
        });
        // ── 5. Extract text response ──────────────────────────────────────────────
        const textContent = response.content.find(c => c.type === 'text');
        const rawText = textContent && 'text' in textContent ? textContent.text : '';
        logEvent(symbolKey, 'info', 'llm_response', `LLM responded (${response.usage.output_tokens} tokens)`, {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
        });
        // ── 6. Parse JSON from response ───────────────────────────────────────────
        const jsonStr = extractJSON(rawText);
        if (!jsonStr) {
            throw new Error(`No JSON block found in LLM response. Raw: ${rawText.slice(0, 300)}`);
        }
        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        }
        catch (e) {
            throw new Error(`Failed to parse LLM JSON: ${String(e)}. Raw: ${jsonStr.slice(0, 300)}`);
        }
        // ── 7. Build result ───────────────────────────────────────────────────────
        const bias = (['bullish', 'bearish', 'neutral'].includes(parsed.bias ?? ''))
            ? parsed.bias
            : 'neutral';
        const keyLevels = mapKeyLevels((parsed.keyLevels ?? []));
        let tradeProposal = null;
        if (parsed.tradeProposal && typeof parsed.tradeProposal === 'object') {
            const tp = parsed.tradeProposal;
            tradeProposal = {
                direction: tp.direction,
                entryZone: tp.entryZone ?? { low: 0, high: 0 },
                stopLoss: Number(tp.stopLoss ?? 0),
                takeProfits: Array.isArray(tp.takeProfits) ? tp.takeProfits.map(Number) : [],
                riskReward: Number(tp.riskReward ?? 0),
                reasoning: String(tp.reasoning ?? ''),
                confidence: (['high', 'medium', 'low'].includes(String(tp.confidence)) ? tp.confidence : 'medium'),
                invalidatedIf: tp.invalidatedIf ? String(tp.invalidatedIf) : undefined,
            };
        }
        // Flatten indicators to a simple Record<string, number|string> for storage
        const indicatorsFlat = {};
        if (indicators.rsi14 != null)
            indicatorsFlat.rsi14 = +indicators.rsi14.toFixed(2);
        if (indicators.ema20 != null)
            indicatorsFlat.ema20 = +indicators.ema20.toFixed(5);
        if (indicators.ema50 != null)
            indicatorsFlat.ema50 = +indicators.ema50.toFixed(5);
        if (indicators.atr14 != null)
            indicatorsFlat.atr14 = +indicators.atr14.toFixed(5);
        if (indicators.vwap)
            indicatorsFlat.vwap = +indicators.vwap.toFixed(5);
        if (indicators.bbWidth != null)
            indicatorsFlat.bbWidth = +indicators.bbWidth.toFixed(5);
        if (indicators.macd) {
            indicatorsFlat.macd_macd = +indicators.macd.macd.toFixed(5);
            indicatorsFlat.macd_signal = +indicators.macd.signal.toFixed(5);
            indicatorsFlat.macd_histogram = +indicators.macd.histogram.toFixed(5);
        }
        if (indicators.adx) {
            indicatorsFlat.adx = +indicators.adx.adx.toFixed(2);
            indicatorsFlat.plusDI = +indicators.adx.plusDI.toFixed(2);
            indicatorsFlat.minusDI = +indicators.adx.minusDI.toFixed(2);
        }
        if (indicators.stoch) {
            indicatorsFlat.stoch_k = +indicators.stoch.k.toFixed(2);
            indicatorsFlat.stoch_d = +indicators.stoch.d.toFixed(2);
        }
        if (indicators.mtf?.confluence != null) {
            indicatorsFlat.mtf_confluence = indicators.mtf.confluence;
        }
        const now = new Date().toISOString();
        const elapsed = Date.now() - startTime;
        const result = {
            symbolKey,
            symbol: sym.symbol,
            market: 'mt5',
            timeframe: primaryTf,
            time: now,
            bias,
            summary: String(parsed.summary ?? ''),
            keyLevels,
            tradeProposal,
            indicators: indicatorsFlat,
            candles: toChartCandles(candleSlice),
            context,
            llmProvider: providerName,
            llmModel: model,
        };
        const id = dbSaveAnalysis(result);
        dbSetLastAnalysisAt(symbolKey, now);
        logEvent(symbolKey, 'info', 'analysis_end', `Analysis complete in ${elapsed}ms — ${bias} bias`, {
            bias, keyLevels: keyLevels.length, hasProposal: !!tradeProposal,
        });
        log.info({ symbolKey, bias, elapsed }, 'analysis complete');
        return { ...result, id };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ symbolKey, err: msg }, 'analysis failed');
        logEvent(symbolKey, 'error', 'analysis_error', `Analysis failed: ${msg}`);
        // Save error record to DB so UI can show it
        const errorResult = {
            symbolKey,
            symbol: sym?.symbol ?? symbolKey,
            market: 'mt5',
            timeframe: sym?.candleConfig?.primaryTimeframe ?? 'h1',
            time: new Date().toISOString(),
            bias: 'neutral',
            summary: '',
            keyLevels: [],
            tradeProposal: null,
            indicators: {},
            candles: [],
            context: {},
            llmProvider: sym?.llmProvider ?? 'unknown',
            llmModel: sym?.llmModel ?? 'unknown',
            error: msg,
        };
        const id = dbSaveAnalysis(errorResult);
        return { ...errorResult, id };
    }
    finally {
        analysisInFlight.delete(symbolKey);
    }
}
export function isAnalysisRunning(symbolKey) {
    return analysisInFlight.has(symbolKey);
}
//# sourceMappingURL=index.js.map