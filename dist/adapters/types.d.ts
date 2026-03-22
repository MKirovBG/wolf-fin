export interface Candle {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
}
export interface Balance {
    asset: string;
    free: number;
    locked: number;
}
export interface Order {
    orderId: number;
    clientOrderId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    type: string;
    price: number;
    origQty: number;
    executedQty: number;
    status: string;
    timeInForce: string;
    time: number;
    updateTime: number;
    profit?: number;
    swap?: number;
    sl?: number;
    tp?: number;
    priceCurrent?: number;
}
export interface Fill {
    symbol: string;
    id: number;
    orderId: number;
    price: number;
    qty: number;
    quoteQty: number;
    commission: number;
    commissionAsset: string;
    time: number;
    isBuyer: boolean;
    isMaker: boolean;
}
export interface OrderBook {
    symbol: string;
    bids: [number, number][];
    asks: [number, number][];
    timestamp: number;
}
export interface Trade {
    id: number;
    price: number;
    qty: number;
    time: number;
    isBuyerMaker: boolean;
}
export interface Indicators {
    rsi14: number;
    ema20: number;
    ema50: number;
    atr14: number;
    vwap: number;
    bbWidth: number;
    /** Multi-timeframe indicator data — optional, present when MTF candles are available */
    mtf?: MTFIndicators;
}
/** Per-timeframe indicator subset */
export interface TFIndicators {
    rsi14: number;
    ema20: number;
    ema50?: number;
    atr14: number;
}
/** Multi-timeframe indicator bundle */
export interface MTFIndicators {
    m15?: TFIndicators;
    h4?: TFIndicators;
    /** Confluence score: -3 (all bearish) to +3 (all bullish). Each TF contributes ±1. */
    confluence: number;
}
export interface RiskState {
    dailyPnlUsd: number;
    remainingBudgetUsd: number;
    positionNotionalUsd: number;
}
export interface KeyLevel {
    price: number;
    type: 'resistance' | 'support' | 'pivot' | 'swing_high' | 'swing_low';
    source: string;
    strength: number;
}
export interface MarketContext {
    /** Crypto sentiment index 0-100, only present for crypto market */
    fearGreed?: {
        value: number;
        classification: string;
    };
    /** Top news headlines for the symbol from CryptoPanic */
    news?: {
        headline: string;
        votes: number;
        url: string;
    }[];
    /** Upcoming high-impact economic events within the next 2 hours */
    upcomingEvents?: {
        name: string;
        country: string;
        impact: string;
        time: number;
    }[];
    /** Macro crypto market data from CoinGecko */
    cryptoMarket?: {
        btcDominance: number;
        totalMarketCapUsd: number;
    };
    /** Recent forex news headlines with sentiment tags — only present for mt5 market */
    forexNews?: {
        headline: string;
        sentiment: 'bullish' | 'bearish' | 'neutral';
        source: string;
        url: string;
    }[];
}
export interface MarketSnapshot {
    symbol: string;
    timestamp: number;
    market: 'crypto' | 'mt5';
    price: {
        bid: number;
        ask: number;
        last: number;
    };
    stats24h: {
        volume: number;
        changePercent: number;
        high: number;
        low: number;
    };
    candles: {
        m1: Candle[];
        m5: Candle[];
        m15: Candle[];
        m30: Candle[];
        h1: Candle[];
        h4: Candle[];
    };
    indicators: Indicators;
    account: {
        balances: Balance[];
        openOrders: Order[];
    };
    risk: RiskState;
    /** Enrichment signals assembled by context.ts */
    context?: MarketContext;
    /** Forex-specific fields — only present when market === 'mt5' */
    forex?: {
        spread: number;
        pipValue: number;
        point: number;
        pipSize: number;
        sessionOpen: boolean;
        swapLong: number;
        swapShort: number;
    };
    /** MT5-specific: rich open position details (sl, tp, profit, swap, priceCurrent) */
    positions?: Record<string, unknown>[];
    /** MT5-specific: pending limit/stop orders not yet filled */
    pendingOrders?: Record<string, unknown>[];
    /** MT5-specific: live account financials (balance, equity, margin, leverage) */
    accountInfo?: {
        balance: number;
        equity: number;
        freeMargin: number;
        usedMargin: number;
        leverage: number;
    };
    /** Auto-computed support/resistance/pivot levels — sorted by proximity to current price */
    keyLevels?: KeyLevel[];
}
export interface OrderParams {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET';
    quantity: number;
    price?: number;
    timeInForce?: 'GTC' | 'IOC' | 'FOK';
    stopPips?: number;
    stopPrice?: number;
    tpPips?: number;
    tpPrice?: number;
}
export interface OrderResult {
    orderId: number;
    clientOrderId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    type: string;
    price: number;
    origQty: number;
    status: string;
    transactTime: number;
}
//# sourceMappingURL=types.d.ts.map