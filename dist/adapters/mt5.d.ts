import type { Balance, Order, Fill, OrderBook, Trade, MarketSnapshot, OrderParams, OrderResult, RiskState } from './types.js';
import type { IMarketAdapter } from './interface.js';
export declare class MT5Adapter implements IMarketAdapter {
    readonly market: "mt5";
    private accountId?;
    constructor(accountId?: number);
    private buildUrl;
    getSnapshot(symbol: string, riskState: RiskState): Promise<MarketSnapshot>;
    getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;
    getRecentTrades(symbol: string, limit?: number): Promise<Trade[]>;
    getBalances(): Promise<Balance[]>;
    getOpenOrders(symbol?: string): Promise<Order[]>;
    getTradeHistory(symbol: string, limit?: number): Promise<Fill[]>;
    placeOrder(params: OrderParams): Promise<OrderResult>;
    cancelOrder(_symbol: string, orderId: string | number): Promise<void>;
    getSpread(symbol: string): Promise<number | null>;
    isMarketOpen(symbol: string): Promise<boolean>;
}
export declare const mt5Adapter: MT5Adapter;
//# sourceMappingURL=mt5.d.ts.map