export interface NewsItem {
    headline: string;
    votes: number;
    url: string;
}
/**
 * Fetches the top 3 "hot" headlines for a given currency from CryptoPanic.
 * Strips the exchange suffix (e.g. BTCUSDT → BTC).
 * Returns [] on any network/parse error.
 */
export declare function fetchCryptoNews(symbol: string, limit?: number): Promise<NewsItem[]>;
//# sourceMappingURL=cryptopanic.d.ts.map