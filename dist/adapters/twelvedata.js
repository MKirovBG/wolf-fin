// Wolf-Fin Twelve Data — primary forex data source (free tier: 8/min, 800/day)
// ── Simple rate limiter (8 requests per 60s) ────────────────────────────────
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 8;
const timestamps = [];
async function rateLimitWait() {
    const now = Date.now();
    // Purge timestamps older than the window
    while (timestamps.length > 0 && timestamps[0] < now - RATE_WINDOW_MS)
        timestamps.shift();
    if (timestamps.length >= RATE_LIMIT) {
        const waitMs = timestamps[0] + RATE_WINDOW_MS - now + 100; // +100ms buffer
        await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    timestamps.push(Date.now());
}
/** Normalise any symbol format to Twelve Data slash style: EURUSD / EUR_USD → EUR/USD */
function toTdSymbol(symbol) {
    const s = symbol.toUpperCase();
    if (s.includes('/'))
        return s;
    if (s.includes('_'))
        return s.replace('_', '/');
    if (s.length === 6)
        return `${s.slice(0, 3)}/${s.slice(3)}`;
    return s;
}
/**
 * Fetches OHLCV candles for a forex pair from Twelve Data.
 * Returns [] when TWELVE_DATA_KEY is missing or on any error.
 */
export async function fetchCandlesTwelveData(symbol, interval, outputsize = 100) {
    const key = process.env.TWELVE_DATA_KEY;
    if (!key)
        return [];
    try {
        await rateLimitWait();
        const tdSymbol = toTdSymbol(symbol);
        const url = `https://api.twelvedata.com/time_series?symbol=${tdSymbol}&interval=${interval}&outputsize=${outputsize}&apikey=${key}`;
        const res = await fetch(url);
        if (!res.ok)
            return [];
        const json = await res.json();
        if (json.status !== 'ok' || !json.values)
            return [];
        const intervalMs = intervalToMs(interval);
        // Twelve Data returns newest first — reverse to oldest-first (same as Binance/Alpaca)
        return [...json.values].reverse().map(c => {
            const t = new Date(c.datetime).getTime();
            return {
                openTime: t,
                open: parseFloat(c.open),
                high: parseFloat(c.high),
                low: parseFloat(c.low),
                close: parseFloat(c.close),
                volume: parseFloat(c.volume),
                closeTime: t + intervalMs,
            };
        });
    }
    catch {
        return [];
    }
}
/** Backward-compatible alias */
export const fetchCandlesFallback = fetchCandlesTwelveData;
/**
 * Fetches the latest quote for a forex pair from Twelve Data.
 * Returns last price; bid/ask are approximated with a conservative 1-pip spread
 * (actual execution spread comes from Alpaca at order time).
 */
export async function fetchQuoteTwelveData(symbol) {
    const key = process.env.TWELVE_DATA_KEY;
    if (!key)
        return null;
    try {
        await rateLimitWait();
        const tdSymbol = toTdSymbol(symbol);
        const url = `https://api.twelvedata.com/price?symbol=${tdSymbol}&apikey=${key}`;
        const res = await fetch(url);
        if (!res.ok)
            return null;
        const json = await res.json();
        if (!json.price)
            return null;
        const price = parseFloat(json.price);
        // Approximate bid/ask with a 1-pip spread (conservative estimate)
        const halfSpread = symbol.toUpperCase().includes('JPY') ? 0.005 : 0.00005;
        return { bid: price - halfSpread, ask: price + halfSpread, last: price };
    }
    catch {
        return null;
    }
}
function intervalToMs(interval) {
    const map = {
        '1min': 60_000,
        '15min': 15 * 60_000,
        '1h': 3_600_000,
        '4h': 4 * 3_600_000,
    };
    return map[interval];
}
//# sourceMappingURL=twelvedata.js.map