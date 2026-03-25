// Wolf-Fin Indicators — pre-computed technical signals from OHLCV candle arrays
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TI = require('technicalindicators');
// ── Helpers ──────────────────────────────────────────────────────────────────
function closes(candles) {
    return candles.map(c => c.close);
}
// ── RSI (14) ─────────────────────────────────────────────────────────────────
export function rsi(candles, period = 14) {
    const prices = closes(candles);
    if (prices.length < period + 1)
        return 50; // neutral fallback
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0)
            avgGain += diff;
        else
            avgLoss += Math.abs(diff);
    }
    avgGain /= period;
    avgLoss /= period;
    for (let i = period + 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        const gain = diff >= 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0)
        return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}
// ── EMA ───────────────────────────────────────────────────────────────────────
export function ema(candles, period) {
    const prices = closes(candles);
    if (prices.length < period)
        return prices[prices.length - 1] ?? 0;
    const k = 2 / (period + 1);
    let value = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
        value = prices[i] * k + value * (1 - k);
    }
    return value;
}
// ── ATR (14) ──────────────────────────────────────────────────────────────────
export function atr(candles, period = 14) {
    if (candles.length < period + 1)
        return 0;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    // Wilder smoothing: seed with simple average, then smooth
    let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
        atrVal = (atrVal * (period - 1) + trs[i]) / period;
    }
    return atrVal;
}
// ── VWAP ──────────────────────────────────────────────────────────────────────
// Typical price VWAP across provided candles (intraday session approximation)
export function vwap(candles) {
    let cumulativePV = 0;
    let cumulativeVol = 0;
    for (const c of candles) {
        const typical = (c.high + c.low + c.close) / 3;
        cumulativePV += typical * c.volume;
        cumulativeVol += c.volume;
    }
    return cumulativeVol === 0 ? 0 : cumulativePV / cumulativeVol;
}
// ── Bollinger Band Width ───────────────────────────────────────────────────────
// BB width = (upper - lower) / middle, using 20-period SMA and 2 std devs
export function bbWidth(candles, period = 20, stdDevMultiplier = 2) {
    const prices = closes(candles);
    if (prices.length < period)
        return 0;
    const slice = prices.slice(-period);
    const middle = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, p) => sum + (p - middle) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    const upper = middle + stdDevMultiplier * stdDev;
    const lower = middle - stdDevMultiplier * stdDev;
    return middle === 0 ? 0 : (upper - lower) / middle;
}
// ── MACD (12/26/9) ────────────────────────────────────────────────────────────
export function computeMacd(candles, fast = 12, slow = 26, signal = 9) {
    if (candles.length < slow + signal)
        return undefined;
    const results = TI.MACD.calculate({
        values: closes(candles), fastPeriod: fast, slowPeriod: slow,
        signalPeriod: signal, SimpleMAOscillator: false, SimpleMASignal: false,
    });
    const last = results[results.length - 1];
    if (!last)
        return undefined;
    return { macd: last.MACD, signal: last.signal, histogram: last.histogram };
}
// ── ADX (14) ─────────────────────────────────────────────────────────────────
export function computeAdx(candles, period = 14) {
    if (candles.length < period + 1)
        return undefined;
    const results = TI.ADX.calculate({
        high: candles.map(c => c.high), low: candles.map(c => c.low),
        close: closes(candles), period,
    });
    const last = results[results.length - 1];
    if (!last)
        return undefined;
    return { adx: last.adx, plusDI: last.pdi, minusDI: last.mdi };
}
// ── Stochastic (14/3) ─────────────────────────────────────────────────────────
export function computeStoch(candles, period = 14, signalPeriod = 3) {
    if (candles.length < period + signalPeriod)
        return undefined;
    const results = TI.Stochastic.calculate({
        high: candles.map(c => c.high), low: candles.map(c => c.low),
        close: closes(candles), period, signalPeriod,
    });
    const last = results[results.length - 1];
    if (!last)
        return undefined;
    return { k: last.k, d: last.d };
}
export function computeIndicators(h1Candles, cfg = {}) {
    const rsiPeriod = cfg.rsiPeriod ?? 14;
    const emaFast = cfg.emaFast ?? 20;
    const emaSlow = cfg.emaSlow ?? 50;
    const atrPeriod = cfg.atrPeriod ?? 14;
    const bbPeriod = cfg.bbPeriod ?? 20;
    const bbStd = cfg.bbStdDev ?? 2;
    const includeVwap = cfg.vwapEnabled !== false;
    const result = {
        rsi14: rsi(h1Candles, rsiPeriod),
        ema20: ema(h1Candles, emaFast),
        ema50: ema(h1Candles, emaSlow),
        atr14: atr(h1Candles, atrPeriod),
        vwap: includeVwap ? vwap(h1Candles) : 0,
        bbWidth: bbWidth(h1Candles, bbPeriod, bbStd),
    };
    if (cfg.macdEnabled)
        result.macd = computeMacd(h1Candles);
    if (cfg.adxEnabled)
        result.adx = computeAdx(h1Candles);
    if (cfg.stochEnabled)
        result.stoch = computeStoch(h1Candles);
    return result;
}
// ── Multi-Timeframe Indicators ───────────────────────────────────────────────
// Computes indicators across M15, H1, and H4. Returns a confluence score
// from -3 (all bearish) to +3 (all bullish) based on EMA cross alignment.
function tfIndicators(candles, includeEma50 = false) {
    if (candles.length < 15)
        return undefined; // not enough data
    const result = {
        rsi14: rsi(candles, 14),
        ema20: ema(candles, 20),
        atr14: atr(candles, 14),
    };
    if (includeEma50 && candles.length >= 50) {
        result.ema50 = ema(candles, 50);
    }
    return result;
}
export function computeMultiTFIndicators(m15Candles, h1Candles, h4Candles, cfg = {}) {
    const emaFast = cfg.emaFast ?? 20;
    const emaSlow = cfg.emaSlow ?? 50;
    const m15 = tfIndicators(m15Candles);
    const h4 = tfIndicators(h4Candles, true);
    const h1Ema20 = ema(h1Candles, emaFast);
    const h1Ema50 = ema(h1Candles, emaSlow);
    // Confluence: each timeframe contributes +1 (bullish) or -1 (bearish)
    let confluence = 0;
    // H1: EMA fast > EMA slow → bullish
    if (h1Candles.length >= emaSlow) {
        confluence += h1Ema20 > h1Ema50 ? 1 : -1;
    }
    // M15: RSI > 50 → bullish momentum
    if (m15?.rsi14 != null) {
        confluence += m15.rsi14 > 50 ? 1 : -1;
    }
    // H4: EMA20 > EMA50 → bullish higher-TF trend
    if (h4?.ema20 != null && h4?.ema50 != null) {
        confluence += h4.ema20 > h4.ema50 ? 1 : -1;
    }
    return { m15, h4, confluence };
}
// ── Key Levels (Support / Resistance / Pivots) ────────────────────────────────
// Computes key price levels from H4 and H1 candle history.
// Returns levels sorted by proximity to current price.
/**
 * Detect swing highs/lows from a candle series.
 * A swing high: candle[i].high is the highest in a window of (lookback) candles on each side.
 * A swing low: candle[i].low is the lowest in a window of (lookback) candles on each side.
 */
function swingPoints(candles, lookback = 3) {
    const highs = [];
    const lows = [];
    // Use candles[lookback..candles.length-lookback-1] so we have context on both sides
    for (let i = lookback; i < candles.length - lookback; i++) {
        const window = candles.slice(i - lookback, i + lookback + 1);
        const isSwingHigh = candles[i].high === Math.max(...window.map(c => c.high));
        const isSwingLow = candles[i].low === Math.min(...window.map(c => c.low));
        if (isSwingHigh)
            highs.push(candles[i].high);
        if (isSwingLow)
            lows.push(candles[i].low);
    }
    return { highs, lows };
}
export function computeKeyLevels(h4Candles, h1Candles, currentPrice) {
    const levels = [];
    // ── 1. Recent daily highs/lows (from H4 — 6 H4 candles = 1 day) ─────────
    // Group H4 into 'days' and pull high/low per day (last 5 days = 30 H4 candles)
    const days = Math.min(5, Math.floor(h4Candles.length / 6));
    for (let d = 0; d < days; d++) {
        const slice = h4Candles.slice(-(d + 1) * 6, d === 0 ? undefined : -d * 6);
        if (slice.length === 0)
            continue;
        const dayHigh = Math.max(...slice.map(c => c.high));
        const dayLow = Math.min(...slice.map(c => c.low));
        const strength = d === 0 ? 3 : d === 1 ? 2 : 1;
        const label = d === 0 ? 'today' : `${d + 1}d_ago`;
        levels.push({ price: dayHigh, type: 'resistance', source: `daily_high_${label}`, strength });
        levels.push({ price: dayLow, type: 'support', source: `daily_low_${label}`, strength });
    }
    // ── 2. Weekly pivot points (from last 5 H4 days ≈ 1 trading week) ────────
    if (h4Candles.length >= 30) {
        const weekCandles = h4Candles.slice(-30);
        const wH = Math.max(...weekCandles.map(c => c.high));
        const wL = Math.min(...weekCandles.map(c => c.low));
        const wC = weekCandles[weekCandles.length - 1].close;
        const pp = (wH + wL + wC) / 3;
        levels.push({ price: pp, type: 'pivot', source: 'weekly_pp', strength: 3 });
        levels.push({ price: 2 * pp - wL, type: 'resistance', source: 'weekly_r1', strength: 2 });
        levels.push({ price: pp + (wH - wL), type: 'resistance', source: 'weekly_r2', strength: 2 });
        levels.push({ price: 2 * pp - wH, type: 'support', source: 'weekly_s1', strength: 2 });
        levels.push({ price: pp - (wH - wL), type: 'support', source: 'weekly_s2', strength: 2 });
    }
    // ── 3. H1 swing highs/lows (last 48 candles = 2 days) ──────────────────
    const recentH1 = h1Candles.slice(-48);
    const { highs: swingHighs, lows: swingLows } = swingPoints(recentH1, 3);
    // Take the 4 most recent distinct swing highs and lows
    const seen = new Set();
    const dedupe = (arr) => arr.filter(p => {
        // Round to 5 sig figs to merge near-identical levels
        const rounded = parseFloat(p.toPrecision(5));
        if (seen.has(rounded))
            return false;
        seen.add(rounded);
        return true;
    });
    for (const p of dedupe(swingHighs).slice(-4)) {
        levels.push({ price: p, type: 'swing_high', source: 'swing_h1', strength: 2 });
    }
    for (const p of dedupe(swingLows).slice(-4)) {
        levels.push({ price: p, type: 'swing_low', source: 'swing_h1', strength: 2 });
    }
    // ── 4. Sort by proximity to current price, remove obvious duplicates ─────
    return levels
        .filter(l => l.price > 0)
        .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
        .slice(0, 12); // Keep top 12 closest levels
}
//# sourceMappingURL=indicators.js.map