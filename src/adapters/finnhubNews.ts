// Wolf-Fin Finnhub Forex News — recent headlines for forex pairs

/**
 * Fetches recent forex news from Finnhub and filters by currency pair relevance.
 * Returns the 5 most recent relevant headlines with a simple bullish/bearish tag.
 */

const BEARISH_WORDS = ['fall', 'drop', 'decline', 'slump', 'weak', 'loss', 'sell', 'down', 'bearish', 'risk-off', 'recession', 'inflation spike', 'hawkish']
const BULLISH_WORDS = ['rise', 'gain', 'surge', 'strong', 'buy', 'up', 'bullish', 'risk-on', 'growth', 'dovish', 'rate cut', 'recovery']

function sentimentTag(headline: string): 'bullish' | 'bearish' | 'neutral' {
  const h = headline.toLowerCase()
  const bullHits = BULLISH_WORDS.filter(w => h.includes(w)).length
  const bearHits = BEARISH_WORDS.filter(w => h.includes(w)).length
  if (bullHits > bearHits) return 'bullish'
  if (bearHits > bullHits) return 'bearish'
  return 'neutral'
}

function extractCurrencies(symbol: string): string[] {
  // EURUSD -> ['EUR', 'USD'], XAUUSD -> ['XAU', 'GOLD', 'USD']
  const s = symbol.toUpperCase()
  const base = s.slice(0, 3)
  const quote = s.slice(3, 6)
  const extras: string[] = []
  if (base === 'XAU') extras.push('GOLD')
  if (base === 'XAG') extras.push('SILVER')
  return [base, quote, ...extras]
}

interface FinnhubArticle {
  headline: string
  summary: string
  url: string
  datetime: number
  source: string
}

export interface ForexNewsItem {
  headline: string
  sentiment: 'bullish' | 'bearish' | 'neutral'
  source: string
  url: string
}

export async function fetchForexNews(symbol: string): Promise<ForexNewsItem[]> {
  const key = process.env.FINNHUB_KEY ?? ''
  if (!key) return []

  try {
    // Fetch both forex and general categories for better coverage
    const categories = ['forex', 'general']
    const fetches = categories.map(cat =>
      fetch(`https://finnhub.io/api/v1/news?category=${cat}&token=${key}`, {
        signal: AbortSignal.timeout(5000),
      }).then(r => r.ok ? r.json() as Promise<FinnhubArticle[]> : [] as FinnhubArticle[])
        .catch(() => [] as FinnhubArticle[])
    )
    const results = await Promise.all(fetches)

    // Deduplicate by headline
    const seen = new Set<string>()
    const allArticles: FinnhubArticle[] = []
    for (const batch of results) {
      for (const a of batch) {
        if (!seen.has(a.headline)) {
          seen.add(a.headline)
          allArticles.push(a)
        }
      }
    }

    const currencies = extractCurrencies(symbol)

    // Filter to articles mentioning any of our currencies
    const relevant = allArticles.filter(a => {
      const text = (a.headline + ' ' + (a.summary ?? '')).toUpperCase()
      return currencies.some(c => text.includes(c))
    })

    // If strict filtering yields too few results, also include all forex-category articles
    const pool = relevant.length >= 3 ? relevant : [...relevant, ...allArticles.filter(a => !relevant.includes(a))].slice(0, 10)

    return pool.slice(0, 5).map(a => ({
      headline: a.headline,
      sentiment: sentimentTag(a.headline),
      source: a.source,
      url: a.url,
    }))
  } catch {
    return []
  }
}
