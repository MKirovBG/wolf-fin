// Wolf-Fin Indicators — pre-computed technical signals from OHLCV candle arrays
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
export function computeIndicators(h1Candles) {
    return {
        rsi14: rsi(h1Candles, 14),
        ema20: ema(h1Candles, 20),
        ema50: ema(h1Candles, 50),
        atr14: atr(h1Candles, 14),
        vwap: vwap(h1Candles),
        bbWidth: bbWidth(h1Candles, 20),
    };
}
//# sourceMappingURL=indicators.js.map