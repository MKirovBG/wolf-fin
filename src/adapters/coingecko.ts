// Wolf-Fin CoinGecko — BTC dominance + total market cap (optional API key)

export interface CryptoMarketData {
  btcDominance: number
  totalMarketCapUsd: number
}

/**
 * Fetches global crypto market data from CoinGecko.
 * Uses the optional COINGECKO_KEY env var if set (higher rate limits).
 * Returns null on any network/parse error.
 */
export async function fetchCryptoMarket(): Promise<CryptoMarketData | null> {
  try {
    const key = process.env.COINGECKO_KEY
    const url = key
      ? `https://pro-api.coingecko.com/api/v3/global?x_cg_pro_api_key=${key}`
      : 'https://api.coingecko.com/api/v3/global'

    const res = await fetch(url)
    if (!res.ok) return null

    const json = await res.json() as {
      data?: {
        market_cap_percentage?: { btc?: number }
        total_market_cap?: { usd?: number }
      }
    }

    const d = json.data
    if (!d) return null

    return {
      btcDominance: d.market_cap_percentage?.btc ?? 0,
      totalMarketCapUsd: d.total_market_cap?.usd ?? 0,
    }
  } catch {
    return null
  }
}
