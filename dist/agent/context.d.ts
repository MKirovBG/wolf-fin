import type { MarketContext } from '../adapters/types.js';
import type { ContextConfig } from '../types.js';
/**
 * Assembles a MarketContext for the given symbol and market.
 * All fetches are parallel and fail gracefully — a broken enrichment
 * source never stops the trading cycle.
 * Pass contextConfig to selectively disable enrichment sources.
 */
export declare function buildMarketContext(symbol: string, market: 'crypto' | 'mt5', cfg?: ContextConfig): Promise<MarketContext>;
//# sourceMappingURL=context.d.ts.map