// Wolf-Fin Context — assembles MarketContext from all enrichment adapters in parallel

import type { MarketContext } from '../adapters/types.js'
import { fetchFearGreed } from '../adapters/feargreed.js'
import { fetchCryptoMarket } from '../adapters/coingecko.js'
import { fetchCryptoNews } from '../adapters/cryptopanic.js'
import { fetchUpcomingEvents } from '../adapters/calendar.js'

/**
 * Assembles a MarketContext for the given symbol and market.
 * All fetches are parallel and fail gracefully — a broken enrichment
 * source never stops the trading cycle.
 */
export async function buildMarketContext(
  symbol: string,
  market: 'crypto' | 'forex' | 'mt5',
): Promise<MarketContext> {
  if (market === 'crypto') {
    const [fearGreed, cryptoMarket, news, upcomingEvents] = await Promise.all([
      fetchFearGreed(),
      fetchCryptoMarket(),
      fetchCryptoNews(symbol),
      fetchUpcomingEvents(),
    ])

    const ctx: MarketContext = {}
    if (fearGreed) ctx.fearGreed = fearGreed
    if (cryptoMarket) ctx.cryptoMarket = cryptoMarket
    if (news.length > 0) ctx.news = news
    if (upcomingEvents.length > 0) ctx.upcomingEvents = upcomingEvents
    return ctx
  }

  // Forex: calendar events only (Fear & Greed and CryptoPanic are crypto-specific)
  const upcomingEvents = await fetchUpcomingEvents()
  const ctx: MarketContext = {}
  if (upcomingEvents.length > 0) ctx.upcomingEvents = upcomingEvents
  return ctx
}
