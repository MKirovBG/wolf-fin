// Wolf-Fin Finnhub Forex News — recent headlines for forex pairs
/**
 * Fetches recent forex news from Finnhub and filters by currency pair relevance.
 * Returns the 5 most recent relevant headlines with a simple bullish/bearish tag.
 */
const BEARISH_WORDS = ['fall', 'drop', 'decline', 'slump', 'weak', 'loss', 'sell', 'down', 'bearish', 'risk-off', 'recession', 'inflation spike', 'hawkish'];
const BULLISH_WORDS = ['rise', 'gain', 'surge', 'strong', 'buy', 'up', 'bullish', 'risk-on', 'growth', 'dovish', 'rate cut', 'recovery'];
function sentimentTag(headline) {
    const h = headline.toLowerCase();
    const bullHits = BULLISH_WORDS.filter(w => h.includes(w)).length;
    const bearHits = BEARISH_WORDS.filter(w => h.includes(w)).length;
    if (bullHits > bearHits)
        return 'bullish';
    if (bearHits > bullHits)
        return 'bearish';
    return 'neutral';
}
function extractCurrencies(symbol) {
    // EURUSD -> ['EUR', 'USD'], XAUUSD -> ['XAU', 'GOLD', 'USD']
    const s = symbol.toUpperCase();
    const base = s.slice(0, 3);
    const quote = s.slice(3, 6);
    const extras = [];
    if (base === 'XAU')
        extras.push('GOLD');
    if (base === 'XAG')
        extras.push('SILVER');
    return [base, quote, ...extras];
}
export async function fetchForexNews(symbol) {
    const key = process.env.FINNHUB_KEY ?? '';
    if (!key)
        return [];
    try {
        const url = `https://finnhub.io/api/v1/news?category=forex&token=${key}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (!res.ok)
            return [];
        const articles = await res.json();
        const currencies = extractCurrencies(symbol);
        // Filter to articles mentioning any of our currencies
        const relevant = articles.filter(a => {
            const text = (a.headline + ' ' + a.summary).toUpperCase();
            return currencies.some(c => text.includes(c));
        });
        return relevant.slice(0, 5).map(a => ({
            headline: a.headline,
            sentiment: sentimentTag(a.headline),
            source: a.source,
            url: a.url,
        }));
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=finnhubNews.js.map