import type { Balance, Order, Fill, OrderBook, Trade, MarketSnapshot, OrderParams, OrderResult, RiskState } from './types.js';
import type { IMarketAdapter } from './interface.js';
import type { IndicatorConfig, CandleConfig } from '../types.js';
export declare class BinanceAdapter implements IMarketAdapter {
    readonly market: "crypto";
    getSnapshot(symbol: string, riskState: RiskState, indicatorCfg?: IndicatorConfig, candleCfg?: CandleConfig): Promise<MarketSnapshot>;
    getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;
    getRecentTrades(symbol: string, limit?: number): Promise<Trade[]>;
    getBalances(): Promise<Balance[]>;
    getOpenOrders(symbol?: string): Promise<Order[]>;
    getTradeHistory(symbol: string, limit?: number): Promise<Fill[]>;
    placeOrder(params: OrderParams): Promise<OrderResult>;
    cancelOrder(symbol: string, orderId: string | number): Promise<void>;
}
export declare const binanceAdapter: BinanceAdapter;
export declare const getSnapshot: (s: string, r: RiskState) => Promise<MarketSnapshot>;
export declare const getOrderBook: (s: string, d?: number) => Promise<OrderBook>;
export declare const getRecentTrades: (s: string, l?: number) => Promise<Trade[]>;
export declare const getBalances: () => Promise<Balance[]>;
export declare const getOpenOrders: (s?: string) => Promise<Order[]>;
export declare const getTradeHistory: (s: string, l?: number) => Promise<Fill[]>;
export declare const placeOrder: (p: OrderParams) => Promise<OrderResult>;
export declare const cancelOrder: (s: string, id: number) => Promise<void>;
//# sourceMappingURL=binance.d.ts.map