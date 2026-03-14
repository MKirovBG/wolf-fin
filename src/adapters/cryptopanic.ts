// Wolf-Fin CryptoPanic — top news headlines for a crypto symbol (no key for basic)

export interface NewsItem {
  headline: string
  votes: number
  url: string
}

/**
 * Fetches the top 3 "hot" headlines for a given currency from CryptoPanic.
 * Strips the exchange suffix (e.g. BTCUSDT → BTC).
 * Returns [] on any network/parse error.
 */
export async function fetchCryptoNews(symbol: string, limit = 3): Promise<NewsItem[]> {
  try {
    // CryptoPanic uses ticker symbols like BTC, ETH — strip quote currency
    const currency = symbol.replace(/USDT?|BUSD|BTC|ETH$/i, '').toUpperCase() || symbol.toUpperCase()

    const url = `https://cryptopanic.com/api/free/v1/posts/?auth_token=free&currencies=${currency}&filter=hot`
    const res = await fetch(url)
    if (!res.ok) return []

    const json = await res.json() as {
      results?: Array<{
        title?: string
        url?: string
        votes?: { positive?: number; negative?: number }
      }>
    }

    return (json.results ?? [])
      .slice(0, limit)
      .map(r => ({
        headline: r.title ?? '',
        votes: (r.votes?.positive ?? 0) - (r.votes?.negative ?? 0),
        url: r.url ?? '',
      }))
      .filter(r => r.headline !== '')
  } catch {
    return []
  }
}
