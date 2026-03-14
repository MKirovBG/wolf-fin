// Wolf-Fin Twelve Data — fallback forex candle source (free tier: 8/min, 800/day)

import type { Candle } from './types.js'

type Interval = '1min' | '15min' | '1h' | '4h'

interface TwelveDataCandle {
  datetime: string
  open: string
  high: string
  low: string
  close: string
  volume: string
}

/**
 * Fetches candles for a forex pair from Twelve Data.
 * Converts OANDA-style symbols (EUR_USD) to Twelve Data style (EUR/USD).
 * Returns [] when TWELVE_DATA_KEY is missing or on any error.
 */
export async function fetchCandlesFallback(
  symbol: string,
  interval: Interval,
  outputsize = 100,
): Promise<Candle[]> {
  const key = process.env.TWELVE_DATA_KEY
  if (!key) return []

  try {
    // Normalise symbol: EUR_USD → EUR/USD
    const tdSymbol = symbol.replace('_', '/')

    const url = `https://api.twelvedata.com/time_series?symbol=${tdSymbol}&interval=${interval}&outputsize=${outputsize}&apikey=${key}`
    const res = await fetch(url)
    if (!res.ok) return []

    const json = await res.json() as {
      status?: string
      values?: TwelveDataCandle[]
    }

    if (json.status !== 'ok' || !json.values) return []

    const intervalMs = intervalToMs(interval)

    // Twelve Data returns newest first — reverse to oldest-first (same as Binance/OANDA)
    return [...json.values].reverse().map(c => {
      const t = new Date(c.datetime).getTime()
      return {
        openTime: t,
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume: parseFloat(c.volume),
        closeTime: t + intervalMs,
      }
    })
  } catch {
    return []
  }
}

function intervalToMs(interval: Interval): number {
  const map: Record<Interval, number> = {
    '1min': 60_000,
    '15min': 15 * 60_000,
    '1h': 3_600_000,
    '4h': 4 * 3_600_000,
  }
  return map[interval]
}
