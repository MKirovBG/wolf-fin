import type { Candle, Balance, Order, Fill, OrderBook, Trade, MarketSnapshot, OrderParams, OrderResult, RiskState } from './types.js';
import type { IMarketAdapter } from './interface.js';
import type { IndicatorConfig, CandleConfig } from '../types.js';
export declare function setBridgeActiveLogin(login: number): void;
export declare function getBridgeActiveLogin(): number | undefined;
interface BridgeDeal {
    ticket: number;
    order: number;
    symbol: string;
    type: number;
    volume: number;
    price: number;
    profit: number;
    commission: number;
    swap: number;
    fee: number;
    magic: number;
    comment: string;
    time: string;
}
export declare class MT5Adapter implements IMarketAdapter {
    readonly market: "mt5";
    private accountId?;
    constructor(accountId?: number);
    private buildUrl;
    getSnapshot(symbol: string, riskState: RiskState, indicatorCfg?: IndicatorConfig, _candleCfg?: CandleConfig): Promise<MarketSnapshot>;
    getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;
    getRecentTrades(symbol: string, limit?: number): Promise<Trade[]>;
    getBalances(): Promise<Balance[]>;
    getOpenOrders(symbol?: string): Promise<Order[]>;
    getTradeHistory(symbol: string, limit?: number): Promise<Fill[]>;
    /** Rich deal history with profit/loss and exit reason (sl, tp, etc.) for LLM reasoning */
    getDeals(symbol?: string, days?: number, limit?: number): Promise<BridgeDeal[]>;
    placeOrder(params: OrderParams): Promise<OrderResult>;
    cancelOrder(_symbol: string, orderId: string | number): Promise<void>;
    closePosition(ticket: number, volume?: number): Promise<{
        closed: boolean;
        ticket: number;
        dealTicket?: number;
        alreadyClosed?: boolean;
    }>;
    modifyPosition(ticket: number, sl?: number, tp?: number): Promise<{
        ok: boolean;
        ticket: number;
        sl?: number;
        tp?: number;
    }>;
    getSpread(symbol: string): Promise<number | null>;
    isMarketOpen(symbol: string): Promise<boolean>;
    /** Fetch large historical candle dataset for backtesting (up to 10,000 bars). */
    getHistoricalCandles(symbol: string, timeframe: 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1', count: number): Promise<Candle[]>;
    /** Fetch current pip size and pip value for a symbol — used by the backtester. */
    getSymbolInfo(symbol: string): Promise<{
        pipSize: number;
        pipValue: number;
        point: number;
    }>;
}
export declare const mt5Adapter: MT5Adapter;
export {};
//# sourceMappingURL=mt5.d.ts.map