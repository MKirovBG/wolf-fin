import type { MarketSnapshot, OrderBook, Trade, Balance, Order, Fill, OrderParams, OrderResult, RiskState } from './types.js';
export interface IMarketAdapter {
    readonly market: 'crypto' | 'mt5';
    getSnapshot(symbol: string, riskState: RiskState): Promise<MarketSnapshot>;
    getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;
    getRecentTrades(symbol: string, limit?: number): Promise<Trade[]>;
    getBalances(): Promise<Balance[]>;
    getOpenOrders(symbol?: string): Promise<Order[]>;
    getTradeHistory(symbol: string, limit?: number): Promise<Fill[]>;
    placeOrder(params: OrderParams): Promise<OrderResult>;
    cancelOrder(symbol: string, orderId: string | number): Promise<void>;
    getSpread?(symbol: string): Promise<number | null>;
    isMarketOpen?(symbol: string): Promise<boolean>;
}
//# sourceMappingURL=interface.d.ts.map