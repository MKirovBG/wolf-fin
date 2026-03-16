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
}
export interface RiskState {
    dailyPnlUsd: number;
    remainingBudgetUsd: number;
    positionNotionalUsd: number;
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
}
export interface MarketSnapshot {
    symbol: string;
    timestamp: number;
    market: 'crypto' | 'forex';
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
        m15: Candle[];
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
    /** Forex-specific fields — only present when market === 'forex' */
    forex?: {
        spread: number;
        pipValue: number;
        sessionOpen: boolean;
        swapLong: number;
        swapShort: number;
    };
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