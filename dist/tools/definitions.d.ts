import Anthropic from '@anthropic-ai/sdk';
export declare const TOOLS: Anthropic.Tool[];
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