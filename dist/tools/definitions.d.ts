import Anthropic from '@anthropic-ai/sdk';
/** Returns the tool list for the given market, excluding tools unsupported by that market. */
export declare function getTools(market: 'crypto' | 'forex' | 'mt5'): Anthropic.Tool[];
export interface GetSnapshotInput {
    symbol: string;
    market: 'crypto' | 'forex' | 'mt5';
}
export interface GetOrderBookInput {
    symbol: string;
    market: 'crypto' | 'forex' | 'mt5';
    depth?: number;
}
export interface GetRecentTradesInput {
    symbol: string;
    market: 'crypto' | 'forex' | 'mt5';
    limit?: number;
}
export interface GetOpenOrdersInput {
    symbol?: string;
    market: 'crypto' | 'forex' | 'mt5';
}
export interface PlaceOrderInput {
    symbol: string;
    market: 'crypto' | 'forex' | 'mt5';
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET';
    quantity: number;
    price?: number;
    timeInForce?: 'GTC' | 'IOC' | 'FOK';
    stopPips?: number;
}
export interface CancelOrderInput {
    symbol: string;
    market: 'crypto' | 'forex' | 'mt5';
    orderId: number;
}
//# sourceMappingURL=definitions.d.ts.map