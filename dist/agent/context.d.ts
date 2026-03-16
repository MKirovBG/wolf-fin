import type { MarketContext } from '../adapters/types.js';
/**
 * Assembles a MarketContext for the given symbol and market.
 * All fetches are parallel and fail gracefully — a broken enrichment
 * source never stops the trading cycle.
 */
export declare function buildMarketContext(symbol: string, market: 'crypto' | 'forex'): Promise<MarketContext>;
//# sourceMappingURL=context.d.ts.map