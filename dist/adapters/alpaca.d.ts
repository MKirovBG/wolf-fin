import type { Balance, Order, Fill, OrderBook, Trade, MarketSnapshot, OrderParams, OrderResult, RiskState } from './types.js';
import type { IMarketAdapter } from './interface.js';
export declare class AlpacaAdapter implements IMarketAdapter {
    readonly market: "forex";
    getSnapshot(symbol: string, riskState: RiskState): Promise<MarketSnapshot>;
    getOrderBook(symbol: string, _depth?: number): Promise<OrderBook>;
    getRecentTrades(_symbol: string, _limit?: number): Promise<Trade[]>;
    getBalances(): Promise<Balance[]>;
    getOpenOrders(symbol?: string): Promise<Order[]>;
    getTradeHistory(symbol: string, limit?: number): Promise<Fill[]>;
    placeOrder(params: OrderParams): Promise<OrderResult>;
    cancelOrder(_symbol: string, orderId: string | number): Promise<void>;
    getSpread(symbol: string): Promise<number | null>;
    isMarketOpen(_symbol: string): Promise<boolean>;
}
export declare const alpacaAdapter: AlpacaAdapter;
//# sourceMappingURL=alpaca.d.ts.map