export interface CryptoMarketData {
    btcDominance: number;
    totalMarketCapUsd: number;
}
/**
 * Fetches global crypto market data from CoinGecko.
 * Uses the optional COINGECKO_KEY env var if set (higher rate limits).
 * Returns null on any network/parse error.
 */
export declare function fetchCryptoMarket(): Promise<CryptoMarketData | null>;
//# sourceMappingURL=coingecko.d.ts.map