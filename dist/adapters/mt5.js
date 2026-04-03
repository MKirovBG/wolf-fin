// Wolf-Fin MT5 Adapter — calls the Python mt5-bridge over localhost HTTP
import { computeIndicators, computeMultiTFIndicators, computeKeyLevels } from './indicators.js';
// ── Bridge HTTP helpers ──────────────────────────────────────────────────────
// MT5_BRIDGE_URL takes precedence (full URL for remote bridge).
// Falls back to localhost with MT5_BRIDGE_PORT for backward compat.
const BASE = () => process.env.MT5_BRIDGE_URL?.replace(/\/+$/, '') ??
    `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`;
// Tracks the login currently active on the bridge (set from /health responses).
// Used by the server for UI display (showing which account is connected).
// NOT used for URL routing — buildUrl never appends ?accountId= regardless.
let bridgeActiveLogin;
export function setBridgeActiveLogin(login) {
    bridgeActiveLogin = login;
}
export function getBridgeActiveLogin() {
    return bridgeActiveLogin;
}
const BRIDGE_KEY = () => process.env.MT5_BRIDGE_KEY ?? '';
function bridgeHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const key = BRIDGE_KEY();
    if (key)
        h['X-Bridge-Key'] = key;
    return h;
}
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
async function mt5Fetch(url, init) {
    let lastErr = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(url, init);
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new Error(`MT5 bridge ${res.status}: ${body}`);
            }
            return res.json();
        }
        catch (err) {
            lastErr = err;
            // Only retry on network errors (ECONNREFUSED, ETIMEDOUT), not HTTP errors
            if (err.message.includes('MT5 bridge'))
                throw err;
            if (attempt < MAX_RETRIES - 1) {
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
            }
        }
    }
    throw lastErr ?? new Error('MT5 bridge unreachable');
}
async function mt5Get(path) {
    return mt5Fetch(`${BASE()}${path}`, { headers: bridgeHeaders() });
}
async function mt5Post(path, body) {
    return mt5Fetch(`${BASE()}${path}`, {
        method: 'POST',
        headers: bridgeHeaders(),
        body: JSON.stringify(body),
    });
}
// ── Symbol conversion ────────────────────────────────────────────────────────
//
// Broker symbols are used exactly as-is — no mapping, no suffix manipulation.
// The agent-create UI loads symbols directly from the connected broker so the
// stored symbol is always the exact name the broker recognises.
function toMt5Symbol(s) {
    // Strip any legacy underscores (e.g. EUR_USD typed manually) and uppercase.
    return s.toUpperCase().replace(/_/g, '');
}
// ── Pip helpers (use MT5 symbol info when available, fallback to heuristic) ──
function isCommodity(symbol) {
    const s = symbol.toUpperCase();
    return s.startsWith('XAU') || s.startsWith('XAG') || s.startsWith('XPT') || s.startsWith('XPD') ||
        s.includes('OIL') || s.includes('GAS') || s.includes('GOLD') || s.includes('SILVER');
}
function pipSizeHeuristic(symbol, point) {
    // Primary path: derive from broker point value — no symbol knowledge needed.
    // MT5 convention: point >= 0.01 → commodity/index/crypto → 1 pip = 1 full price unit.
    //                 point <  0.01 → forex → 1 pip = point × 10 (standard 10-point pip).
    // Examples: EURUSD point=0.00001→0.0001, USDJPY point=0.001→0.01, XAUUSD/US500 point=0.01→1.0
    if (point != null && point > 0) {
        return point >= 0.01 ? 1.0 : point * 10;
    }
    // Fallback: broker point unavailable (e.g. no snapshot yet). Use symbol name only as last resort.
    if (isCommodity(symbol))
        return 1.0;
    if (symbol.toUpperCase().includes('JPY'))
        return 0.01;
    return 0.0001;
}
// ── MT5Adapter ───────────────────────────────────────────────────────────────
export class MT5Adapter {
    market = 'mt5';
    accountId;
    constructor(accountId) {
        this.accountId = accountId;
    }
    buildUrl(path) {
        // MT5 bridge is single-account: all endpoints serve the active account on
        // parameterless routes. The ?accountId= parameter is not supported — the
        // bridge returns 404 for every account including the active one when it
        // receives an accountId query param unless explicitly multi-account configured.
        // accountId is stored on the adapter for identity purposes only, not routing.
        return path;
    }
    async getSnapshot(symbol, riskState, indicatorCfg, _candleCfg) {
        const snap = await mt5Get(this.buildUrl(`/snapshot/${toMt5Symbol(symbol)}`));
        const mapCandles = (arr) => arr.map(c => ({
            openTime: c.openTime,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            closeTime: c.closeTime,
        }));
        const m1 = mapCandles(snap.candles.m1);
        const m5 = mapCandles(snap.candles.m5 ?? []);
        const m15 = mapCandles(snap.candles.m15);
        const m30 = mapCandles(snap.candles.m30 ?? []);
        const h1 = mapCandles(snap.candles.h1);
        const h4 = mapCandles(snap.candles.h4);
        // Warn when M5/M30 are missing — bridge may need updating
        if (m5.length === 0)
            console.warn(`[mt5] M5 candles empty for ${symbol} — bridge may not support this timeframe`);
        if (m30.length === 0)
            console.warn(`[mt5] M30 candles empty for ${symbol} — bridge may not support this timeframe`);
        const { bid, ask, last } = snap.price;
        const mid = last || (bid + ask) / 2;
        // 24h stats from H1 candles
        const last24h = h1.slice(-24);
        const high24h = last24h.reduce((m, c) => Math.max(m, c.high), 0);
        const low24h = last24h.reduce((m, c) => Math.min(m, c.low), Infinity);
        const firstOpen = last24h[0]?.open ?? mid;
        const changePercent = firstOpen !== 0 ? ((mid - firstOpen) / firstOpen) * 100 : 0;
        const totalVolume = last24h.reduce((s, c) => s + c.volume, 0);
        const info = snap.symbol_info;
        const point = info.point || pipSizeHeuristic(symbol);
        // Map account
        const balances = [
            { asset: 'EQUITY', free: snap.account.equity, locked: snap.account.margin },
            { asset: 'BALANCE', free: snap.account.balance, locked: 0 },
            { asset: 'FREE_MARGIN', free: snap.account.free_margin, locked: 0 },
        ];
        // Map positions to open orders (generic interface)
        const openOrders = snap.positions.map(p => ({
            orderId: p.ticket,
            clientOrderId: `mt5-${p.ticket}`,
            symbol: p.symbol,
            side: p.side,
            type: 'MARKET',
            price: p.priceOpen,
            origQty: p.volume,
            executedQty: p.volume,
            status: 'OPEN',
            timeInForce: 'GTC',
            time: new Date(p.time).getTime(),
            updateTime: Date.now(),
        }));
        // Rich MT5 position detail — includes sl/tp/currentProfit for LLM reasoning
        const positions = snap.positions.map(p => ({
            ticket: p.ticket,
            symbol: p.symbol,
            side: p.side,
            volume: p.volume,
            priceOpen: p.priceOpen,
            priceCurrent: p.priceCurrent,
            profit: p.profit,
            swap: p.swap,
            sl: p.sl > 0 ? p.sl : null,
            tp: p.tp > 0 ? p.tp : null,
            comment: p.comment,
        }));
        // Pending limit/stop orders for this symbol
        const pendingOrders = snap.pending_orders.map(o => ({
            ticket: o.ticket,
            symbol: o.symbol,
            type: o.type, // BUY_LIMIT | SELL_LIMIT | BUY_STOP | SELL_STOP
            volume: o.volume_initial,
            priceTarget: o.price_open,
            priceCurrent: o.price_current,
            sl: o.sl > 0 ? o.sl : null,
            tp: o.tp > 0 ? o.tp : null,
            comment: o.comment,
        }));
        // Pip value: $ per pip per 1 standard lot.
        // pipSize defines what "1 pip" means (0.0001 for forex, 1.0 for gold).
        // For EURUSD: 0.0001 * 100000 = $10/pip/lot.  For XAUUSD: 1.0 * 100 = $100/pip/lot.
        const contractSize = info.trade_contract_size || 100_000;
        const pipSize = pipSizeHeuristic(symbol, point);
        const pipValue = pipSize * contractSize;
        const keyLevels = computeKeyLevels(h4, h1, mid);
        return {
            symbol: snap.symbol || symbol,
            timestamp: Date.now(),
            market: 'mt5',
            price: { bid, ask, last: mid },
            stats24h: {
                volume: totalVolume,
                changePercent,
                high: high24h,
                low: low24h === Infinity ? 0 : low24h,
            },
            candles: { m1, m5, m15, m30, h1, h4 },
            indicators: {
                ...computeIndicators(h1, indicatorCfg),
                ...(indicatorCfg?.mtfEnabled !== false ? { mtf: computeMultiTFIndicators(m15, h1, h4, indicatorCfg) } : {}),
            },
            account: { balances, openOrders },
            positions, // rich MT5 position detail (sl, tp, profit, priceCurrent, swap)
            pendingOrders, // pending limit/stop orders not yet filled
            risk: riskState,
            accountInfo: {
                balance: snap.account.balance,
                equity: snap.account.equity,
                freeMargin: snap.account.free_margin,
                usedMargin: snap.account.margin,
                leverage: snap.account.leverage,
            },
            forex: {
                spread: info.spread * point / pipSize,
                pipValue,
                point,
                pipSize,
                sessionOpen: info.session_open,
                swapLong: info.swap_long,
                swapShort: info.swap_short,
            },
            keyLevels,
        };
    }
    async getOrderBook(symbol, depth = 20) {
        const data = await mt5Get(this.buildUrl(`/orderbook/${toMt5Symbol(symbol)}?depth=${depth}`));
        return {
            symbol,
            bids: data.bids.map((b) => [b[0], b[1]]),
            asks: data.asks.map((a) => [a[0], a[1]]),
            timestamp: data.timestamp,
        };
    }
    async getRecentTrades(symbol, limit = 50) {
        const data = await mt5Get(this.buildUrl(`/trades/${toMt5Symbol(symbol)}?count=${limit}`));
        return data.trades.map((t, i) => ({
            id: i,
            price: t.price,
            qty: t.volume,
            time: t.time,
            isBuyerMaker: t.isBuyerMaker,
        }));
    }
    async getBalances() {
        const acct = await mt5Get(this.buildUrl('/account'));
        return [
            { asset: 'EQUITY', free: acct.equity, locked: acct.margin },
            { asset: 'BALANCE', free: acct.balance, locked: 0 },
            { asset: 'FREE_MARGIN', free: acct.free_margin, locked: 0 },
        ];
    }
    async getOpenOrders(symbol) {
        const sym = symbol ? toMt5Symbol(symbol) : undefined;
        const posPath = sym ? `/positions?symbol=${sym}` : '/positions';
        const ordPath = sym ? `/orders?symbol=${sym}` : '/orders';
        // Fetch both open positions AND pending limit/stop orders in parallel
        const [positions, pendingOrders] = await Promise.all([
            mt5Get(this.buildUrl(posPath)),
            mt5Get(this.buildUrl(ordPath)).catch(() => []),
        ]);
        const openPositions = positions.map(p => ({
            orderId: p.ticket,
            clientOrderId: `mt5-pos-${p.ticket}`,
            symbol: p.symbol,
            side: p.side,
            type: 'MARKET',
            price: p.priceOpen,
            origQty: p.volume,
            executedQty: p.volume,
            status: 'OPEN',
            timeInForce: 'GTC',
            time: new Date(p.time).getTime(),
            updateTime: Date.now(),
            profit: p.profit,
            swap: p.swap,
            sl: p.sl,
            tp: p.tp,
            priceCurrent: p.priceCurrent,
        }));
        const pending = pendingOrders.map(o => ({
            orderId: o.ticket,
            clientOrderId: `mt5-pending-${o.ticket}`,
            symbol: o.symbol,
            side: o.type.startsWith('BUY') ? 'BUY' : 'SELL',
            type: o.type, // BUY_LIMIT | SELL_LIMIT | BUY_STOP | SELL_STOP
            price: o.price_open,
            origQty: o.volume_initial,
            executedQty: 0,
            status: 'NEW', // pending, not yet filled
            timeInForce: 'GTC',
            time: new Date(o.time).getTime(),
            updateTime: Date.now(),
        }));
        return [...openPositions, ...pending];
    }
    async getTradeHistory(symbol, limit = 50) {
        const deals = await mt5Get(this.buildUrl(`/history/deals?symbol=${toMt5Symbol(symbol)}&limit=${limit}`));
        return deals.map(d => ({
            symbol: d.symbol,
            id: d.ticket,
            orderId: d.order,
            price: d.price,
            qty: d.volume,
            quoteQty: d.price * d.volume,
            commission: d.commission,
            commissionAsset: 'USD',
            time: new Date(d.time).getTime(),
            isBuyer: d.type === 0, // DEAL_TYPE_BUY
            isMaker: false,
        }));
    }
    /** Rich deal history with profit/loss and exit reason (sl, tp, etc.) for LLM reasoning */
    async getDeals(symbol, days = 1, limit = 20) {
        const sym = symbol ? `&symbol=${toMt5Symbol(symbol)}` : '';
        return mt5Get(this.buildUrl(`/history/deals?days=${days}&limit=${limit}${sym}`));
    }
    async placeOrder(params) {
        const magic = parseInt(process.env.MT5_MAGIC ?? '123456');
        const deviation = parseInt(process.env.MT5_DEVIATION ?? '10');
        const body = {
            symbol: toMt5Symbol(params.symbol),
            action: params.side,
            order_type: params.type,
            volume: params.quantity,
            deviation,
            magic,
            comment: 'wolf-fin',
        };
        // MARKET orders must NOT include a price — MT5 executes at best available.
        // Sending a price for MARKET causes error 10015 (Invalid price).
        // For LIMIT/STOP orders, price is required.
        if (params.type !== 'MARKET' && params.price != null)
            body.price = params.price;
        // Compute absolute stop-loss price from stopPips.
        // For MARKET orders, use params.price as the reference execution estimate (agent provides it).
        if (params.stopPrice != null) {
            body.sl = params.stopPrice;
        }
        else if (params.stopPips != null) {
            const refPrice = params.price; // agent-supplied reference (bid for SELL, ask for BUY)
            if (refPrice != null) {
                const pipSz = pipSizeHeuristic(params.symbol);
                body.sl = params.side === 'BUY'
                    ? refPrice - params.stopPips * pipSz
                    : refPrice + params.stopPips * pipSz;
            }
        }
        // Compute absolute take-profit price from tpPips.
        if (params.tpPrice != null) {
            body.tp = params.tpPrice;
        }
        else if (params.tpPips != null) {
            const refPrice = params.price;
            if (refPrice != null) {
                const pipSz = pipSizeHeuristic(params.symbol);
                body.tp = params.side === 'BUY'
                    ? refPrice + params.tpPips * pipSz
                    : refPrice - params.tpPips * pipSz;
            }
        }
        let result;
        try {
            result = await mt5Post('/order', body);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // 10015 = Invalid price — give the agent an actionable error instead of a raw 502
            if (msg.includes('10015')) {
                throw new Error(`Price rejected by broker (MT5 #10015) — market has moved since you read the snapshot. ` +
                    `For MARKET orders: omit the price field. For LIMIT orders: use the current bid/ask from this tick's snapshot.`);
            }
            throw err;
        }
        return {
            orderId: result.order,
            clientOrderId: `mt5-${result.deal}`,
            symbol: params.symbol,
            side: params.side,
            type: params.type,
            price: result.price,
            origQty: result.volume,
            // deal=0 means the order is pending (LIMIT/STOP not yet filled); deal>0 means it executed immediately
            status: result.deal > 0 ? 'FILLED' : 'NEW',
            transactTime: Date.now(),
        };
    }
    async cancelOrder(_symbol, orderId) {
        const body = { ticket: Number(orderId) };
        try {
            await mt5Post('/order/cancel', body);
        }
        catch {
            // Fall back to close (handles case where agent calls cancel on an open position)
            try {
                await mt5Post('/order/close', body);
            }
            catch (closeErr) {
                const msg = closeErr instanceof Error ? closeErr.message : String(closeErr);
                // 404 = already gone — not an error, just stale state
                if (msg.includes('404') || msg.includes('not found'))
                    return;
                throw closeErr;
            }
        }
    }
    async closePosition(ticket, volume) {
        const body = { ticket };
        if (volume != null)
            body.volume = volume;
        try {
            const res = await mt5Post('/order/close', body);
            return { closed: true, ticket, dealTicket: res.deal };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('404') || msg.includes('not found')) {
                // Position already closed externally — return gracefully so agent knows
                return { closed: false, ticket, alreadyClosed: true };
            }
            throw err;
        }
    }
    async modifyPosition(ticket, sl, tp) {
        const body = { ticket };
        if (sl != null)
            body.sl = sl;
        if (tp != null)
            body.tp = tp;
        const res = await mt5Post('/order/modify', body);
        return { ok: true, ticket: res.ticket, sl: res.sl, tp: res.tp };
    }
    async getSpread(symbol) {
        const info = await mt5Get(this.buildUrl(`/symbol-info/${toMt5Symbol(symbol)}`));
        const pipSz = pipSizeHeuristic(symbol, info.point);
        return (info.spread * info.point) / pipSz;
    }
    async isMarketOpen(symbol) {
        const info = await mt5Get(this.buildUrl(`/symbol-info/${toMt5Symbol(symbol)}`));
        // trade_mode: 0 = SYMBOL_TRADE_MODE_DISABLED, others = various trade modes
        // In practice, trade_mode > 0 means trading is allowed
        return info.trade_mode > 0;
    }
    /** Fetch large historical candle dataset for backtesting (up to 10,000 bars). */
    async getHistoricalCandles(symbol, timeframe, count) {
        const capped = Math.min(Math.max(count, 1), 10_000);
        const url = this.buildUrl(`/candles/${toMt5Symbol(symbol)}?timeframe=${timeframe}&count=${capped}`);
        const res = await mt5Get(url);
        return res.candles.map(c => ({
            openTime: c.openTime,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            closeTime: c.closeTime,
        }));
    }
    /** Fetch current pip size and pip value for a symbol — used by the backtester. */
    async getSymbolInfo(symbol) {
        const info = await mt5Get(this.buildUrl(`/symbol-info/${toMt5Symbol(symbol)}`));
        const pipSz = pipSizeHeuristic(symbol, info.point);
        const pipVal = info.trade_tick_value ?? 1;
        return { pipSize: pipSz, pipValue: pipVal, point: info.point };
    }
    /**
     * Fetch everything needed for an analysis run: current price, all timeframe candles,
     * and symbol info. Does not require RiskState — for use by the analyzer module.
     */
    async fetchAnalysisData(symbol) {
        const snap = await mt5Get(this.buildUrl(`/snapshot/${toMt5Symbol(symbol)}`));
        const mapCandles = (arr) => arr.map(c => ({
            openTime: c.openTime,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            closeTime: c.closeTime,
        }));
        // Some bridge versions omit m5/m30 from snapshot — fetch them separately if empty.
        const TF_BRIDGE = {
            m1: 'M1', m5: 'M5', m15: 'M15', m30: 'M30', h1: 'H1', h4: 'H4',
        };
        const resolveTf = async (tf, fromSnap, count = 150) => {
            const mapped = mapCandles(fromSnap ?? []);
            if (mapped.length > 0)
                return mapped;
            // Snapshot missing this TF — fetch directly
            try {
                return await this.getHistoricalCandles(symbol, TF_BRIDGE[tf], count);
            }
            catch {
                return [];
            }
        };
        const [m1, m5, m15, m30, h1, h4] = await Promise.all([
            resolveTf('m1', snap.candles.m1),
            resolveTf('m5', snap.candles.m5),
            resolveTf('m15', snap.candles.m15),
            resolveTf('m30', snap.candles.m30),
            resolveTf('h1', snap.candles.h1),
            resolveTf('h4', snap.candles.h4),
        ]);
        const { bid, ask, last } = snap.price;
        const mid = last || (bid + ask) / 2;
        const info = snap.symbol_info;
        const point = info.point || pipSizeHeuristic(symbol);
        const pipSz = pipSizeHeuristic(symbol, point);
        const spread = info.spread * point / pipSz;
        return {
            price: { bid, ask, mid, spread },
            candles: { m1, m5, m15, m30, h1, h4 },
            symbolInfo: {
                point: info.point,
                digits: info.digits,
                volumeMin: info.volume_min,
                volumeStep: info.volume_step,
                contractSize: info.trade_contract_size || 100_000,
            },
        };
    }
}
export const mt5Adapter = new MT5Adapter();
//# sourceMappingURL=mt5.js.map