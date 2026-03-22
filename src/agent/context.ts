// Wolf-Fin Context — assembles MarketContext from all enrichment adapters in parallel

import type { MarketContext } from '../adapters/types.js'
import { fetchFearGreed } from '../adapters/feargreed.js'
import { fetchCryptoMarket } from '../adapters/coingecko.js'
import { fetchCryptoNews } from '../adapters/cryptopanic.js'
import { fetchUpcomingEvents } from '../adapters/calendar.js'
import { fetchForexNews } from '../adapters/finnhubNews.js'
import type { ContextConfig } from '../types.js'

/**
 * Assembles a MarketContext for the given symbol and market.
 * All fetches are parallel and fail gracefully — a broken enrichment
 * source never stops the trading cycle.
 * Pass contextConfig to selectively disable enrichment sources.
 */
export async function buildMarketContext(
  symbol: string,
  market: 'crypto' | 'mt5',
  cfg: ContextConfig = {},
): Promise<MarketContext> {
  if (market === 'crypto') {
    const wantFearGreed    = cfg.fearGreed       !== false
    const wantCryptoMarket = cfg.cryptoMarket    !== false
    const wantNews         = cfg.news            !== false
    const wantCalendar     = cfg.economicCalendar !== false

    const [fearGreed, cryptoMarket, news, upcomingEvents] = await Promise.all([
      wantFearGreed    ? fetchFearGreed()          : Promise.resolve(null),
      wantCryptoMarket ? fetchCryptoMarket()       : Promise.resolve(null),
      wantNews         ? fetchCryptoNews(symbol)   : Promise.resolve([]),
      wantCalendar     ? fetchUpcomingEvents()     : Promise.resolve([]),
    ])

    const ctx: MarketContext = {}
    if (fearGreed) ctx.fearGreed = fearGreed
    if (cryptoMarket) ctx.cryptoMarket = cryptoMarket
    if (news.length > 0) ctx.news = news
    if (upcomingEvents.length > 0) ctx.upcomingEvents = upcomingEvents
    return ctx
  }

  // Forex/MT5: calendar events + Finnhub forex news
  const wantCalendar  = cfg.economicCalendar !== false
  const wantForexNews = cfg.forexNews        !== false

  const [upcomingEvents, forexNews] = await Promise.all([
    wantCalendar  ? fetchUpcomingEvents()   : Promise.resolve([]),
    wantForexNews ? fetchForexNews(symbol)  : Promise.resolve([]),
  ])
  const ctx: MarketContext = {}
  if (upcomingEvents.length > 0) ctx.upcomingEvents = upcomingEvents
  if (forexNews.length > 0) ctx.forexNews = forexNews
  return ctx
}
