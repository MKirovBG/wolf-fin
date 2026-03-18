export interface ForexNewsItem {
    headline: string;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    source: string;
    url: string;
}
export declare function fetchForexNews(symbol: string): Promise<ForexNewsItem[]>;
//# sourceMappingURL=finnhubNews.d.ts.map