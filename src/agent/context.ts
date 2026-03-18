// Wolf-Fin Context — assembles MarketContext from all enrichment adapters in parallel

import type { MarketContext } from '../adapters/types.js'
import { fetchFearGreed } from '../adapters/feargreed.js'
import { fetchCryptoMarket } from '../adapters/coingecko.js'
import { fetchCryptoNews } from '../adapters/cryptopanic.js'
import { fetchUpcomingEvents } from '../adapters/calendar.js'
import { fetchForexNews } from '../adapters/finnhubNews.js'

/**
 * Assembles a MarketContext for the given symbol and market.
 * All fetches are parallel and fail gracefully — a broken enrichment
 * source never stops the trading cycle.
 */
export async function buildMarketContext(
  symbol: string,
  market: 'crypto' | 'mt5',
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

  // Forex/MT5: calendar events + Finnhub forex news
  const [upcomingEvents, forexNews] = await Promise.all([
    fetchUpcomingEvents(),
    fetchForexNews(symbol),
  ])
  const ctx: MarketContext = {}
  if (upcomingEvents.length > 0) ctx.upcomingEvents = upcomingEvents
  if (forexNews.length > 0) ctx.forexNews = forexNews
  return ctx
}
