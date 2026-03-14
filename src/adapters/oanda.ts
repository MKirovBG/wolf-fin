// Wolf-Fin OANDA Adapter — v20 REST fetch wrapper implementing IMarketAdapter

import type {
  Candle,
  Balance,
  Order,
  Fill,
  OrderBook,
  Trade,
  MarketSnapshot,
  OrderParams,
  OrderResult,
  RiskState,
} from './types.js'
import type { IMarketAdapter } from './interface.js'
import { computeIndicators } from './indicators.js'
import { isForexSessionOpen } from './session.js'

// ── Config ────────────────────────────────────────────────────────────────────

function baseUrl(): string {
  return process.env.OANDA_PAPER === 'false'
    ? 'https://api-fxtrade.oanda.com'
    : 'https://api-fxpractice.oanda.com'
}

function accountId(): string {
  const id = process.env.OANDA_ACCOUNT_ID
  if (!id) throw new Error('OANDA_ACCOUNT_ID is not set')
  return id
}

function headers(): Record<string, string> {
  const key = process.env.OANDA_API_KEY
  if (!key) throw new Error('OANDA_API_KEY is not set')
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function oandaFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${baseUrl()}${path}`
  const res = await fetch(url, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string> ?? {}) } })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OANDA ${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

// ── Pip helpers ───────────────────────────────────────────────────────────────

/**
 * Returns pip size for a currency pair.
 * JPY pairs: 0.01, all others: 0.0001
 */
export function pipSize(symbol: string): number {
  return symbol.toUpperCase().includes('JPY') ? 0.01 : 0.0001
}

/**
 * Converts a raw price difference to pips.
 */
export function toPips(priceDiff: number, symbol: string): number {
  return priceDiff / pipSize(symbol)
}

/**
 * USD pip value for a standard lot (100,000 units).
 * For pairs where USD is the quote (e.g. EUR/USD): pip value = 0.0001 × 100000 = $10
 * For JPY pairs (e.g. USD/JPY): pip value = 0.01 × 100000 / current_price
 * This returns an approximation; for exact values OANDA's account summary is authoritative.
 */
export function pipValueUsd(symbol: string, currentPrice: number): number {
  if (symbol.toUpperCase().includes('JPY')) {
    return (0.01 * 100_000) / currentPrice
  }
  return 0.0001 * 100_000 // $10 per pip for most USD-quoted pairs
}

// ── Candle mapping ────────────────────────────────────────────────────────────

type OandaGranularity = 'M1' | 'M15' | 'H1' | 'H4'

interface OandaCandle {
  time: string
  mid?: { o: string; h: string; l: string; c: string }
  volume: number
  complete: boolean
}

async function fetchCandles(symbol: string, granularity: OandaGranularity, count = 100): Promise<Candle[]> {
  const data = await oandaFetch<{ candles: OandaCandle[] }>(
    `/v3/instruments/${symbol}/candles?granularity=${granularity}&count=${count}&price=M`,
  )
  return data.candles
    .filter(c => c.complete && c.mid)
    .map(c => {
      const t = new Date(c.time).getTime()
      const m = c.mid!
      return {
        openTime: t,
        open: parseFloat(m.o),
        high: parseFloat(m.h),
        low: parseFloat(m.l),
        close: parseFloat(m.c),
        volume: c.volume,
        closeTime: t + granularityMs(granularity),
      }
    })
}

function granularityMs(g: OandaGranularity): number {
  const map: Record<OandaGranularity, number> = {
    M1: 60_000,
    M15: 15 * 60_000,
    H1: 3600_000,
    H4: 4 * 3600_000,
  }
  return map[g]
}

// ── OandaAdapter ──────────────────────────────────────────────────────────────

export class OandaAdapter implements IMarketAdapter {
  readonly market = 'forex' as const

  async getSnapshot(symbol: string, riskState: RiskState): Promise<MarketSnapshot> {
    const acc = accountId()

    const [m1, m15, h1, h4, pricingData, summaryData, tradesData] = await Promise.all([
      fetchCandles(symbol, 'M1', 100),
      fetchCandles(symbol, 'M15', 100),
      fetchCandles(symbol, 'H1', 100),
      fetchCandles(symbol, 'H4', 100),
      oandaFetch<{
        prices: Array<{
          bids: Array<{ price: string }>
          asks: Array<{ price: string }>
          tradeable: boolean
        }>
      }>(`/v3/accounts/${acc}/pricing?instruments=${symbol}`),
      oandaFetch<{
        account: {
          balance: string
          NAV: string
          marginUsed: string
          marginAvailable: string
          unrealizedPL: string
        }
      }>(`/v3/accounts/${acc}/summary`),
      oandaFetch<{
        trades: Array<{
          id: string
          instrument: string
          price: string
          currentUnits: string
          unrealizedPL: string
        }>
      }>(`/v3/accounts/${acc}/openTrades`),
    ])

    const price0 = pricingData.prices[0]
    const bid = price0 ? parseFloat(price0.bids[0]?.price ?? '0') : 0
    const ask = price0 ? parseFloat(price0.asks[0]?.price ?? '0') : 0
    const mid = (bid + ask) / 2

    // 24h stats derived from H1 candles (OANDA has no 24hr ticker endpoint)
    const last24h = h1.slice(-24)
    const high24h = last24h.reduce((m, c) => Math.max(m, c.high), 0)
    const low24h = last24h.reduce((m, c) => Math.min(m, c.low), Infinity)
    const firstClose = last24h[0]?.open ?? mid
    const changePercent = firstClose !== 0 ? ((mid - firstClose) / firstClose) * 100 : 0
    const totalVolume = last24h.reduce((s, c) => s + c.volume, 0)

    const acct = summaryData.account
    const balances: Balance[] = [
      { asset: 'NAV', free: parseFloat(acct.NAV), locked: parseFloat(acct.marginUsed) },
      { asset: 'MARGIN_AVAILABLE', free: parseFloat(acct.marginAvailable), locked: 0 },
    ]

    const openOrders: Order[] = tradesData.trades.map(t => {
      const units = parseFloat(t.currentUnits)
      return {
        orderId: parseInt(t.id),
        clientOrderId: t.id,
        symbol: t.instrument,
        side: units >= 0 ? 'BUY' : 'SELL',
        type: 'MARKET',
        price: parseFloat(t.price),
        origQty: Math.abs(units),
        executedQty: Math.abs(units),
        status: 'OPEN',
        timeInForce: 'GTC',
        time: Date.now(),
        updateTime: Date.now(),
      }
    })

    const pip = pipSize(symbol)
    const spread = toPips(ask - bid, symbol)
    const sessionOpen = isForexSessionOpen()

    return {
      symbol,
      timestamp: Date.now(),
      market: 'forex',
      price: { bid, ask, last: mid },
      stats24h: {
        volume: totalVolume,
        changePercent,
        high: high24h,
        low: low24h === Infinity ? 0 : low24h,
      },
      candles: { m1, m15, h1, h4 },
      indicators: computeIndicators(h1),
      account: { balances, openOrders },
      risk: riskState,
      forex: {
        spread,
        pipValue: pipValueUsd(symbol, mid),
        sessionOpen,
        swapLong: 0,   // OANDA swap rates require separate financing endpoint — placeholder
        swapShort: 0,
      },
    }
  }

  async getOrderBook(symbol: string, _depth = 20): Promise<OrderBook> {
    // OANDA pricing gives a single best bid/ask level; we model it as a 1-level book
    const acc = accountId()
    const data = await oandaFetch<{
      prices: Array<{
        bids: Array<{ price: string; liquidity: number }>
        asks: Array<{ price: string; liquidity: number }>
      }>
    }>(`/v3/accounts/${acc}/pricing?instruments=${symbol}`)

    const p = data.prices[0]
    return {
      symbol,
      bids: (p?.bids ?? []).map(b => [parseFloat(b.price), b.liquidity] as [number, number]),
      asks: (p?.asks ?? []).map(a => [parseFloat(a.price), a.liquidity] as [number, number]),
      timestamp: Date.now(),
    }
  }

  // OANDA v20 REST does not expose a public recent-trades tape; return empty
  async getRecentTrades(_symbol: string, _limit = 50): Promise<Trade[]> {
    return []
  }

  async getBalances(): Promise<Balance[]> {
    const acc = accountId()
    const data = await oandaFetch<{
      account: { balance: string; NAV: string; marginUsed: string; marginAvailable: string }
    }>(`/v3/accounts/${acc}/summary`)
    const a = data.account
    return [
      { asset: 'NAV', free: parseFloat(a.NAV), locked: parseFloat(a.marginUsed) },
      { asset: 'MARGIN_AVAILABLE', free: parseFloat(a.marginAvailable), locked: 0 },
    ]
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const acc = accountId()
    const data = await oandaFetch<{
      trades: Array<{
        id: string
        instrument: string
        price: string
        currentUnits: string
        unrealizedPL: string
      }>
    }>(`/v3/accounts/${acc}/openTrades`)

    return data.trades
      .filter(t => !symbol || t.instrument === symbol)
      .map(t => {
        const units = parseFloat(t.currentUnits)
        return {
          orderId: parseInt(t.id),
          clientOrderId: t.id,
          symbol: t.instrument,
          side: units >= 0 ? 'BUY' : 'SELL',
          type: 'MARKET',
          price: parseFloat(t.price),
          origQty: Math.abs(units),
          executedQty: Math.abs(units),
          status: 'OPEN',
          timeInForce: 'GTC',
          time: Date.now(),
          updateTime: Date.now(),
        }
      })
  }

  async getTradeHistory(symbol: string, limit = 50): Promise<Fill[]> {
    const acc = accountId()
    const data = await oandaFetch<{
      trades: Array<{
        id: string
        instrument: string
        price: string
        initialUnits: string
        realizedPL: string
        openTime: string
        closeTime?: string
      }>
    }>(`/v3/accounts/${acc}/trades?state=CLOSED&instrument=${symbol}&count=${limit}`)

    return data.trades.map(t => ({
      symbol: t.instrument,
      id: parseInt(t.id),
      orderId: parseInt(t.id),
      price: parseFloat(t.price),
      qty: Math.abs(parseFloat(t.initialUnits)),
      quoteQty: 0,
      commission: 0,
      commissionAsset: 'USD',
      time: new Date(t.closeTime ?? t.openTime).getTime(),
      isBuyer: parseFloat(t.initialUnits) > 0,
      isMaker: false,
    }))
  }

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    const acc = accountId()
    const units = params.side === 'BUY' ? params.quantity : -params.quantity

    const orderBody: Record<string, unknown> = {
      order: {
        type: params.type === 'LIMIT' ? 'LIMIT' : 'MARKET',
        instrument: params.symbol,
        units: units.toString(),
        timeInForce: params.type === 'LIMIT' ? (params.timeInForce ?? 'GTC') : 'FOK',
        ...(params.type === 'LIMIT' && params.price != null
          ? { price: params.price.toFixed(5) }
          : {}),
        ...(params.stopPips != null
          ? {
              stopLossOnFill: {
                distance: (params.stopPips * pipSize(params.symbol)).toFixed(5),
              },
            }
          : {}),
      },
    }

    const data = await oandaFetch<{
      orderCreateTransaction?: { id: string; price: string; units: string; type: string }
      relatedTransactionIDs?: string[]
    }>(`/v3/accounts/${acc}/orders`, {
      method: 'POST',
      body: JSON.stringify(orderBody),
    })

    const tx = data.orderCreateTransaction
    const orderId = tx ? parseInt(tx.id) : Date.now()
    return {
      orderId,
      clientOrderId: tx?.id ?? String(orderId),
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      price: tx ? parseFloat(tx.price ?? '0') : (params.price ?? 0),
      origQty: params.quantity,
      status: 'ACCEPTED',
      transactTime: Date.now(),
    }
  }

  async cancelOrder(symbol: string, orderId: string | number): Promise<void> {
    const acc = accountId()
    await oandaFetch(`/v3/accounts/${acc}/orders/${orderId}/cancel`, { method: 'PUT' })
  }

  async getSpread(symbol: string): Promise<number | null> {
    const acc = accountId()
    const data = await oandaFetch<{
      prices: Array<{ bids: Array<{ price: string }>; asks: Array<{ price: string }> }>
    }>(`/v3/accounts/${acc}/pricing?instruments=${symbol}`)
    const p = data.prices[0]
    if (!p) return null
    const bid = parseFloat(p.bids[0]?.price ?? '0')
    const ask = parseFloat(p.asks[0]?.price ?? '0')
    return toPips(ask - bid, symbol)
  }

  async isMarketOpen(_symbol: string): Promise<boolean> {
    return isForexSessionOpen()
  }
}

export const oandaAdapter = new OandaAdapter()
