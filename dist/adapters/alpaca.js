// Wolf-Fin Alpaca Adapter — REST wrapper implementing IMarketAdapter for forex
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const Alpaca = _require('@alpacahq/alpaca-trade-api');
import { computeIndicators } from './indicators.js';
import { isForexSessionOpen } from './session.js';
import { fetchCandlesTwelveData, fetchQuoteTwelveData } from './twelvedata.js';
// ── Pip helpers ───────────────────────────────────────────────────────────────
function pipSize(symbol) {
    return symbol.toUpperCase().includes('JPY') ? 0.01 : 0.0001;
}
function toPips(priceDiff, symbol) {
    return priceDiff / pipSize(symbol);
}
function pipValueUsd(symbol, currentPrice) {
    if (symbol.toUpperCase().includes('JPY')) {
        return (0.01 * 100_000) / currentPrice;
    }
    return 0.0001 * 100_000;
}
// ── Client factory ────────────────────────────────────────────────────────────
function createClient() {
    const paper = process.env.ALPACA_PAPER !== 'false';
    return new Alpaca({
        keyId: paper
            ? (process.env.ALPACA_PAPER_KEY ?? '')
            : (process.env.ALPACA_API_KEY ?? ''),
        secretKey: paper
            ? (process.env.ALPACA_PAPER_SECRET ?? '')
            : (process.env.ALPACA_API_SECRET ?? ''),
        paper,
    });
}
let _client = null;
function alpaca() {
    if (!_client)
        _client = createClient();
    return _client;
}
// ── Symbol conversion ─────────────────────────────────────────────────────────
// Normalise any format to Alpaca's slash style: XAUUSD / XAU_USD → XAU/USD
function toAlpacaSymbol(symbol) {
    const s = symbol.toUpperCase();
    if (s.includes('/'))
        return s;
    if (s.includes('_'))
        return s.replace('_', '/');
    if (s.length === 6)
        return `${s.slice(0, 3)}/${s.slice(3)}`;
    return s;
}
// ── Alpaca data REST helper ───────────────────────────────────────────────────
// Alpaca FX data requires a paid subscription. We try Alpaca first for latest
// quotes (bid/ask accuracy), but fall back to Twelve Data for everything.
const DATA_BASE = 'https://data.alpaca.markets';
function dataHeaders() {
    return {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY ?? '',
        'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET ?? '',
    };
}
/** Strip slashes/underscores: EUR/USD → EURUSD (Alpaca rates format) */
function toAlpacaRatesSymbol(symbol) {
    return symbol.toUpperCase().replace(/[/_]/g, '');
}
async function alpacaDataGet(path, params) {
    const url = new URL(`${DATA_BASE}${path}`);
    for (const [k, v] of Object.entries(params))
        url.searchParams.set(k, String(v));
    const res = await fetch(url.toString(), { headers: dataHeaders() });
    if (res.status === 403 || res.status === 404)
        return null; // not authorized or not found
    if (!res.ok)
        return null; // don't throw — Twelve Data will handle it
    return res.json();
}
const timeframeToTd = {
    '1Min': '1min',
    '15Min': '15min',
    '1Hour': '1h',
    '4Hour': '4h',
};
async function fetchCandles(symbol, timeframe, limit = 100) {
    // Primary: Twelve Data (always available with free key)
    const tdInterval = timeframeToTd[timeframe];
    const tdCandles = await fetchCandlesTwelveData(symbol, tdInterval, limit);
    if (tdCandles.length > 0)
        return tdCandles;
    // Fallback: Alpaca rates API (requires paid FX data subscription)
    const ratesSym = toAlpacaRatesSymbol(symbol);
    const data = await alpacaDataGet('/v1beta1/forex/rates', { currency_pairs: ratesSym, timeframe: timeframe === '4Hour' ? '1Min' : timeframe, limit, sort: 'asc' });
    if (!data)
        return [];
    const rates = data.rates?.[ratesSym] ?? [];
    const timeframeMs = { '1Min': 60_000, '15Min': 15 * 60_000, '1Hour': 3_600_000, '4Hour': 4 * 3_600_000 };
    const ms = timeframeMs[timeframe];
    // Synthesize candles from rate snapshots (bid/mid/ask → OHLCV approximation)
    return rates.map(r => {
        const t = new Date(r.t).getTime();
        return { openTime: t, open: r.mp, high: r.ap, low: r.bp, close: r.mp, volume: 0, closeTime: t + ms };
    });
}
async function fetchLatestQuote(symbol) {
    // Primary: Alpaca latest rates (most accurate bid/ask if subscription active)
    const ratesSym = toAlpacaRatesSymbol(symbol);
    const data = await alpacaDataGet('/v1beta1/forex/latest/rates', { currency_pairs: ratesSym });
    if (data?.rates?.[ratesSym]) {
        const r = data.rates[ratesSym];
        return { bp: r.bp, ap: r.ap };
    }
    // Fallback: Twelve Data real-time price (free tier)
    const quote = await fetchQuoteTwelveData(symbol);
    if (quote)
        return { bp: quote.bid, ap: quote.ask };
    return { bp: 0, ap: 0 };
}
// ── AlpacaAdapter ─────────────────────────────────────────────────────────────
export class AlpacaAdapter {
    market = 'forex';
    async getSnapshot(symbol, riskState) {
        const alpacaSymbol = toAlpacaSymbol(symbol);
        // Fetch Twelve Data candles sequentially to stay within 8/min rate limit,
        // while Alpaca account/positions calls run in parallel (separate API).
        const accountPromise = alpaca().getAccount().catch(() => null);
        const positionsPromise = alpaca().getPositions().catch(() => []);
        // Sequential candle fetches (Twelve Data free tier: 8 req/min)
        const m1 = await fetchCandles(symbol, '1Min', 100);
        const m15 = await fetchCandles(symbol, '15Min', 100);
        const h1 = await fetchCandles(symbol, '1Hour', 100);
        const h4 = await fetchCandles(symbol, '4Hour', 100);
        const quote = await fetchLatestQuote(symbol);
        const [accountResult, positionsResult] = await Promise.all([accountPromise, positionsPromise]);
        const bid = quote.bp ?? 0;
        const ask = quote.ap ?? 0;
        const mid = (bid + ask) / 2;
        // 24h stats derived from H1 candles
        const last24h = h1.slice(-24);
        const high24h = last24h.reduce((m, c) => Math.max(m, c.high), 0);
        const low24h = last24h.reduce((m, c) => Math.min(m, c.low), Infinity);
        const firstOpen = last24h[0]?.open ?? mid;
        const changePercent = firstOpen !== 0 ? ((mid - firstOpen) / firstOpen) * 100 : 0;
        const totalVolume = last24h.reduce((s, c) => s + c.volume, 0);
        const account = accountResult;
        const positions = positionsResult ?? [];
        const balances = account
            ? [
                { asset: 'EQUITY', free: parseFloat(account.equity), locked: parseFloat(account.initial_margin) },
                { asset: 'BUYING_POWER', free: parseFloat(account.buying_power), locked: 0 },
            ]
            : [];
        const openOrders = positions
            .filter(p => !symbol || p.symbol === alpacaSymbol)
            .map(p => ({
            orderId: Date.now(),
            clientOrderId: p.symbol,
            symbol: p.symbol,
            side: p.side === 'long' ? 'BUY' : 'SELL',
            type: 'MARKET',
            price: parseFloat(p.avg_entry_price),
            origQty: Math.abs(parseFloat(p.qty)),
            executedQty: Math.abs(parseFloat(p.qty)),
            status: 'OPEN',
            timeInForce: 'GTC',
            time: Date.now(),
            updateTime: Date.now(),
        }));
        const spread = toPips(ask - bid, symbol);
        const sessionOpen = isForexSessionOpen();
        return {
            symbol,
            timestamp: Date.now(),
            market: 'forex',
            price: { bid, ask, last: mid },
            stats24h: {
                volume: totalVolume,
                changePercent,
                high: high24h,
                low: low24h === Infinity ? 0 : low24h,
            },
            candles: { m1, m15, h1, h4 },
            indicators: computeIndicators(h1),
            account: { balances, openOrders },
            risk: riskState,
            forex: {
                spread,
                pipValue: pipValueUsd(symbol, mid),
                sessionOpen,
                swapLong: 0,
                swapShort: 0,
            },
        };
    }
    async getOrderBook(symbol, _depth = 20) {
        const quote = await fetchLatestQuote(symbol);
        return {
            symbol,
            bids: [[quote.bp, 0]],
            asks: [[quote.ap, 0]],
            timestamp: Date.now(),
        };
    }
    // Alpaca forex does not expose a public trade tape
    async getRecentTrades(_symbol, _limit = 50) {
        return [];
    }
    async getBalances() {
        const account = await alpaca().getAccount();
        return [
            { asset: 'EQUITY', free: parseFloat(account.equity), locked: parseFloat(account.initial_margin) },
            { asset: 'BUYING_POWER', free: parseFloat(account.buying_power), locked: 0 },
        ];
    }
    async getOpenOrders(symbol) {
        const positions = await alpaca().getPositions();
        const alpacaSymbol = symbol ? toAlpacaSymbol(symbol) : undefined;
        return positions
            .filter(p => !alpacaSymbol || p.symbol === alpacaSymbol)
            .map(p => ({
            orderId: Date.now(),
            clientOrderId: p.symbol,
            symbol: p.symbol,
            side: p.side === 'long' ? 'BUY' : 'SELL',
            type: 'MARKET',
            price: parseFloat(p.avg_entry_price),
            origQty: Math.abs(parseFloat(p.qty)),
            executedQty: Math.abs(parseFloat(p.qty)),
            status: 'OPEN',
            timeInForce: 'GTC',
            time: Date.now(),
            updateTime: Date.now(),
        }));
    }
    async getTradeHistory(symbol, limit = 50) {
        const alpacaSymbol = toAlpacaSymbol(symbol);
        const activities = await alpaca().getAccountActivities({
            activityTypes: 'FILL',
            pageSize: limit,
        });
        return activities
            .filter(a => a.symbol === alpacaSymbol)
            .map(a => ({
            symbol: a.symbol,
            id: parseInt(a.id),
            orderId: parseInt(a.id),
            price: parseFloat(a.price),
            qty: parseFloat(a.qty),
            quoteQty: parseFloat(a.price) * parseFloat(a.qty),
            commission: 0,
            commissionAsset: 'USD',
            time: new Date(a.transaction_time).getTime(),
            isBuyer: a.side === 'buy',
            isMaker: false,
        }));
    }
    async placeOrder(params) {
        const alpacaSymbol = toAlpacaSymbol(params.symbol);
        const orderReq = {
            symbol: alpacaSymbol,
            qty: params.quantity,
            side: params.side === 'BUY' ? 'buy' : 'sell',
            type: params.type === 'LIMIT' ? 'limit' : 'market',
            time_in_force: (params.timeInForce ?? 'gtc').toLowerCase(),
            ...(params.type === 'LIMIT' && params.price != null
                ? { limit_price: params.price }
                : {}),
            ...(params.stopPrice != null
                ? { order_class: 'bracket', stop_loss: { stop_price: params.stopPrice.toFixed(5) } }
                : {}),
        };
        const order = await alpaca().createOrder(orderReq);
        return {
            orderId: parseInt(order.id.replace(/-/g, '').slice(0, 9), 16),
            clientOrderId: order.client_order_id,
            symbol: params.symbol,
            side: params.side,
            type: params.type,
            price: order.limit_price ? parseFloat(order.limit_price) : (params.price ?? 0),
            origQty: parseFloat(order.qty),
            status: order.status.toUpperCase(),
            transactTime: new Date(order.created_at).getTime(),
        };
    }
    async cancelOrder(_symbol, orderId) {
        await alpaca().cancelOrder(String(orderId));
    }
    async getSpread(symbol) {
        const quote = await fetchLatestQuote(symbol);
        if (!quote.bp && !quote.ap)
            return null;
        return toPips(quote.ap - quote.bp, symbol);
    }
    async isMarketOpen(_symbol) {
        return isForexSessionOpen();
    }
}
export const alpacaAdapter = new AlpacaAdapter();
//# sourceMappingURL=alpaca.js.map