// Wolf-Fin CoinGecko — BTC dominance + total market cap (optional API key)
/**
 * Fetches global crypto market data from CoinGecko.
 * Uses the optional COINGECKO_KEY env var if set (higher rate limits).
 * Returns null on any network/parse error.
 */
export async function fetchCryptoMarket() {
    try {
        const key = process.env.COINGECKO_KEY?.trim();
        const isDemo = key?.startsWith('CG-');
        const url = key && !isDemo
            ? `https://pro-api.coingecko.com/api/v3/global`
            : 'https://api.coingecko.com/api/v3/global';
        const headers = {};
        if (key && isDemo)
            headers['x-cg-demo-api-key'] = key;
        if (key && !isDemo)
            headers['x-cg-pro-api-key'] = key;
        const res = await fetch(url, { headers });
        if (!res.ok)
            return null;
        const json = await res.json();
        const d = json.data;
        if (!d)
            return null;
        return {
            btcDominance: d.market_cap_percentage?.btc ?? 0,
            totalMarketCapUsd: d.total_market_cap?.usd ?? 0,
        };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=coingecko.js.map