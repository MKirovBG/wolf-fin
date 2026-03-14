// Wolf-Fin Binance Adapter — REST wrapper + MarketSnapshot assembly

import { MainClient } from 'binance'
import type { Kline } from 'binance'
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

// ── Client factory ────────────────────────────────────────────────────────────

function createClient(): MainClient {
  const key = process.env.BINANCE_API_KEY ?? ''
  const secret = process.env.BINANCE_API_SECRET ?? ''
  const testnet = process.env.BINANCE_TESTNET === 'true'
  return new MainClient({ api_key: key, api_secret: secret, testnet })
}

let _client: MainClient | null = null
function client(): MainClient {
  if (!_client) _client = createClient()
  return _client
}

// ── Type coercion helpers ─────────────────────────────────────────────────────

function num(v: string | number): number {
  return typeof v === 'number' ? v : parseFloat(v)
}

function mapKlines(raw: Kline[]): Candle[] {
  return raw.map(k => ({
    openTime: k[0],
    open: num(k[1]),
    high: num(k[2]),
    low: num(k[3]),
    close: num(k[4]),
    volume: num(k[5]),
    closeTime: k[6],
  }))
}

// ── BinanceAdapter ────────────────────────────────────────────────────────────

export class BinanceAdapter implements IMarketAdapter {
  readonly market = 'crypto' as const

  async getSnapshot(symbol: string, riskState: RiskState): Promise<MarketSnapshot> {
    const c = client()

    const [ticker, m1raw, m15raw, h1raw, h4raw, bookTicker, account, openOrders] =
      await Promise.all([
        c.get24hrChangeStatistics({ symbol }) as Promise<import('binance').DailyChangeStatistic>,
        c.getKlines({ symbol, interval: '1m', limit: 100 }),
        c.getKlines({ symbol, interval: '15m', limit: 100 }),
        c.getKlines({ symbol, interval: '1h', limit: 100 }),
        c.getKlines({ symbol, interval: '4h', limit: 100 }),
        c.getOrderBook({ symbol, limit: 5 }),
        c.getAccountInformation(),
        c.getOpenOrders({ symbol }),
      ])

    const m1 = mapKlines(m1raw)
    const m15 = mapKlines(m15raw)
    const h1 = mapKlines(h1raw)
    const h4 = mapKlines(h4raw)

    const bid = num(bookTicker.bids[0]?.[0] ?? 0)
    const ask = num(bookTicker.asks[0]?.[0] ?? 0)
    const last = num(ticker.lastPrice)

    const balances: Balance[] = account.balances
      .filter(b => num(b.free) > 0 || num(b.locked) > 0)
      .map(b => ({ asset: b.asset, free: num(b.free), locked: num(b.locked) }))

    const orders: Order[] = openOrders.map(o => ({
      orderId: o.orderId,
      clientOrderId: o.clientOrderId,
      symbol: o.symbol,
      side: o.side as 'BUY' | 'SELL',
      type: o.type,
      price: num(o.price),
      origQty: num(o.origQty),
      executedQty: num(o.executedQty),
      status: o.status,
      timeInForce: o.timeInForce,
      time: o.time,
      updateTime: o.updateTime,
    }))

    return {
      symbol,
      timestamp: Date.now(),
      market: 'crypto',
      price: { bid, ask, last },
      stats24h: {
        volume: num(ticker.volume),
        changePercent: num(ticker.priceChangePercent),
        high: num(ticker.highPrice),
        low: num(ticker.lowPrice),
      },
      candles: { m1, m15, h1, h4 },
      indicators: computeIndicators(h1),
      account: { balances, openOrders: orders },
      risk: riskState,
    }
  }

  async getOrderBook(symbol: string, depth = 20): Promise<OrderBook> {
    const raw = await client().getOrderBook({ symbol, limit: depth as 5 | 10 | 20 | 50 | 100 | 500 | 1000 | 5000 })
    return {
      symbol,
      bids: raw.bids.map(([p, q]) => [num(p), num(q)]),
      asks: raw.asks.map(([p, q]) => [num(p), num(q)]),
      timestamp: Date.now(),
    }
  }

  async getRecentTrades(symbol: string, limit = 50): Promise<Trade[]> {
    const raw = await client().getRecentTrades({ symbol, limit })
    return raw.map(t => ({
      id: t.id,
      price: num(t.price),
      qty: num(t.qty),
      time: t.time,
      isBuyerMaker: t.isBuyerMaker,
    }))
  }

  async getBalances(): Promise<Balance[]> {
    const info = await client().getAccountInformation()
    return info.balances
      .filter(b => num(b.free) > 0 || num(b.locked) > 0)
      .map(b => ({ asset: b.asset, free: num(b.free), locked: num(b.locked) }))
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const raw = await client().getOpenOrders(symbol ? { symbol } : {})
    return raw.map(o => ({
      orderId: o.orderId,
      clientOrderId: o.clientOrderId,
      symbol: o.symbol,
      side: o.side as 'BUY' | 'SELL',
      type: o.type,
      price: num(o.price),
      origQty: num(o.origQty),
      executedQty: num(o.executedQty),
      status: o.status,
      timeInForce: o.timeInForce,
      time: o.time,
      updateTime: o.updateTime,
    }))
  }

  async getTradeHistory(symbol: string, limit = 50): Promise<Fill[]> {
    const raw = await client().getAccountTradeList({ symbol, limit })
    return raw.map(t => ({
      symbol: t.symbol,
      id: t.id,
      orderId: t.orderId,
      price: num(t.price),
      qty: num(t.qty),
      quoteQty: num(t.quoteQty),
      commission: num(t.commission),
      commissionAsset: t.commissionAsset,
      time: t.time,
      isBuyer: t.isBuyer,
      isMaker: t.isMaker,
    }))
  }

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    const c = client()
    const base = {
      symbol: params.symbol,
      side: params.side,
      quantity: params.quantity,
    }

    let raw: import('binance').OrderResponseFull
    if (params.type === 'LIMIT') {
      if (params.price == null) throw new Error('LIMIT order requires price')
      raw = await c.submitNewOrder({
        ...base,
        type: 'LIMIT',
        price: params.price,
        timeInForce: params.timeInForce ?? 'GTC',
        newOrderRespType: 'FULL',
      })
    } else {
      raw = await c.submitNewOrder({
        ...base,
        type: 'MARKET',
        newOrderRespType: 'FULL',
      })
    }

    return {
      orderId: raw.orderId,
      clientOrderId: raw.clientOrderId,
      symbol: raw.symbol,
      side: raw.side as 'BUY' | 'SELL',
      type: raw.type,
      price: num(raw.price),
      origQty: num(raw.origQty),
      status: raw.status,
      transactTime: raw.transactTime,
    }
  }

  async cancelOrder(symbol: string, orderId: string | number): Promise<void> {
    await client().cancelOrder({ symbol, orderId: Number(orderId) })
  }
}

// Singleton instance used by the registry and backward-compat exports
export const binanceAdapter = new BinanceAdapter()

// ── Backward-compatible standalone exports ────────────────────────────────────

export const getSnapshot = (s: string, r: RiskState) => binanceAdapter.getSnapshot(s, r)
export const getOrderBook = (s: string, d?: number) => binanceAdapter.getOrderBook(s, d)
export const getRecentTrades = (s: string, l?: number) => binanceAdapter.getRecentTrades(s, l)
export const getBalances = () => binanceAdapter.getBalances()
export const getOpenOrders = (s?: string) => binanceAdapter.getOpenOrders(s)
export const getTradeHistory = (s: string, l?: number) => binanceAdapter.getTradeHistory(s, l)
export const placeOrder = (p: OrderParams) => binanceAdapter.placeOrder(p)
export const cancelOrder = (s: string, id: number) => binanceAdapter.cancelOrder(s, id)
