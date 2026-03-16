// Wolf-Fin MT5 Adapter — calls the Python mt5-bridge over localhost HTTP
import { computeIndicators } from './indicators.js';
// ── Bridge HTTP helpers ──────────────────────────────────────────────────────
const BASE = () => `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`;
async function mt5Get(path) {
    const res = await fetch(`${BASE()}${path}`);
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`MT5 bridge ${res.status}: ${body}`);
    }
    return res.json();
}
async function mt5Post(path, body) {
    const res = await fetch(`${BASE()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`MT5 bridge ${res.status}: ${text}`);
    }
    return res.json();
}
// ── Symbol conversion ────────────────────────────────────────────────────────
function toMt5Symbol(s) {
    return s.toUpperCase().replace(/_/g, '');
}
function fromMt5Symbol(s) {
    // 6-char all-alpha → forex pair: EURUSD → EUR_USD
    if (s.length === 6 && /^[A-Z]{6}$/.test(s)) {
        return `${s.slice(0, 3)}_${s.slice(3)}`;
    }
    return s;
}
// ── Pip helpers (use MT5 symbol info when available, fallback to heuristic) ──
function isCommodity(symbol) {
    const s = symbol.toUpperCase();
    return s.startsWith('XAU') || s.startsWith('XAG') || s.startsWith('XPT') || s.startsWith('XPD') ||
        s.includes('OIL') || s.includes('GAS') || s.includes('GOLD') || s.includes('SILVER');
}
function pipSizeHeuristic(symbol, point) {
    // Commodities: pip == point (e.g., XAUUSD point=0.01, 1 point IS 1 pip in gold terms)
    if (isCommodity(symbol))
        return point ?? 0.01;
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
        if (!this.accountId)
            return path;
        const sep = path.includes('?') ? '&' : '?';
        return `${path}${sep}accountId=${this.accountId}`;
    }
    async getSnapshot(symbol, riskState) {
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
        const m15 = mapCandles(snap.candles.m15);
        const h1 = mapCandles(snap.candles.h1);
        const h4 = mapCandles(snap.candles.h4);
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
        // Map positions to open orders
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
        // Pip value: for standard forex, point * contract_size
        // For 6-char forex pairs: pipValue = point * contractSize (e.g. 0.0001 * 100000 = 10 USD per lot)
        const contractSize = info.trade_contract_size || 100_000;
        const pipValue = point * contractSize;
        return {
            symbol: fromMt5Symbol(snap.symbol) || symbol,
            timestamp: Date.now(),
            market: 'mt5',
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
                spread: info.spread * point / pipSizeHeuristic(symbol, point),
                pipValue,
                point,
                sessionOpen: info.session_open,
                swapLong: info.swap_long,
                swapShort: info.swap_short,
            },
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
        const path = symbol ? `/positions?symbol=${toMt5Symbol(symbol)}` : '/positions';
        const positions = await mt5Get(this.buildUrl(path));
        return positions.map(p => ({
            orderId: p.ticket,
            clientOrderId: `mt5-${p.ticket}`,
            symbol: fromMt5Symbol(p.symbol),
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
    }
    async getTradeHistory(symbol, limit = 50) {
        const deals = await mt5Get(this.buildUrl(`/history/deals?symbol=${toMt5Symbol(symbol)}&limit=${limit}`));
        return deals.map(d => ({
            symbol: fromMt5Symbol(d.symbol),
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
        if (this.accountId)
            body.accountId = this.accountId;
        if (params.price != null)
            body.price = params.price;
        // Compute stop-loss from stopPips if provided
        if (params.stopPrice != null) {
            body.sl = params.stopPrice;
        }
        else if (params.stopPips != null && params.price != null) {
            const pipSz = pipSizeHeuristic(params.symbol);
            body.sl = params.side === 'BUY'
                ? params.price - params.stopPips * pipSz
                : params.price + params.stopPips * pipSz;
        }
        const result = await mt5Post('/order', body);
        return {
            orderId: result.order,
            clientOrderId: `mt5-${result.deal}`,
            symbol: params.symbol,
            side: params.side,
            type: params.type,
            price: result.price,
            origQty: result.volume,
            status: 'FILLED',
            transactTime: Date.now(),
        };
    }
    async cancelOrder(_symbol, orderId) {
        // Try closing as position first, then as pending order
        const closeBody = { ticket: Number(orderId) };
        if (this.accountId)
            closeBody.accountId = this.accountId;
        const cancelBody = { ticket: Number(orderId) };
        if (this.accountId)
            cancelBody.accountId = this.accountId;
        try {
            await mt5Post('/order/close', closeBody);
        }
        catch {
            await mt5Post('/order/cancel', cancelBody);
        }
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
}
export const mt5Adapter = new MT5Adapter();
//# sourceMappingURL=mt5.js.map