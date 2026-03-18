import Anthropic from '@anthropic-ai/sdk';
/** Returns the tool list for the given market, excluding tools unsupported by that market.
 *  When cycleType is 'planning', trading execution tools are excluded. */
export declare function getTools(market: 'crypto' | 'mt5', cycleType?: 'trading' | 'planning'): Anthropic.Tool[];
export interface GetSnapshotInput {
    symbol: string;
    market: 'crypto' | 'mt5';
}
export interface GetOrderBookInput {
    symbol: string;
    market: 'crypto' | 'mt5';
    depth?: number;
}
export interface GetRecentTradesInput {
    symbol: string;
    market: 'crypto' | 'mt5';
    limit?: number;
}
export interface GetOpenOrdersInput {
    symbol?: string;
    market: 'crypto' | 'mt5';
}
export interface PlaceOrderInput {
    symbol: string;
    market: 'crypto' | 'mt5';
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET';
    quantity: number;
    price?: number;
    timeInForce?: 'GTC' | 'IOC' | 'FOK';
    stopPips?: number;
}
export interface CancelOrderInput {
    symbol: string;
    market: 'crypto' | 'mt5';
    orderId: number;
}
export interface ClosePositionInput {
    ticket: number;
    market: 'crypto' | 'mt5';
    volume?: number;
}
export interface GetTradeHistoryInput {
    symbol: string;
    market: 'crypto' | 'mt5';
    days?: number;
    limit?: number;
}
//# sourceMappingURL=definitions.d.ts.map