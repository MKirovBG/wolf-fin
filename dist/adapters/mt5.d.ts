import type { Balance, Order, Fill, OrderBook, Trade, MarketSnapshot, OrderParams, OrderResult, RiskState } from './types.js';
import type { IMarketAdapter } from './interface.js';
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
    getSnapshot(symbol: string, riskState: RiskState): Promise<MarketSnapshot>;
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
}
export declare const mt5Adapter: MT5Adapter;
export {};
//# sourceMappingURL=mt5.d.ts.map