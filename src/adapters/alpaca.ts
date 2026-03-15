// Wolf-Fin Alpaca Adapter — REST wrapper implementing IMarketAdapter for forex

import { createRequire } from 'module'
const _require = createRequire(import.meta.url)
const Alpaca = _require('@alpacahq/alpaca-trade-api') as new (config: {
  keyId: string
  secretKey: string
  paper: boolean
}) => AlpacaClient

// Minimal typing for the methods we use
interface AlpacaClient {
  getForexBars(symbol: string, opts: { timeframe: string; limit: number }): Promise<unknown[]>
  getForexLatestQuote(symbol: string): Promise<unknown>
  getAccount(): Promise<unknown>
  getPositions(): Promise<unknown[]>
  getAccountActivities(opts: { activityTypes: string; pageSize: number }): Promise<unknown[]>
  createOrder(opts: Record<string, unknown>): Promise<unknown>
  cancelOrder(orderId: string): Promise<void>
}

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
import { pipSize, toPips, pipValueUsd } from './oanda.js'

// ── Client factory ────────────────────────────────────────────────────────────

function createClient(): AlpacaClient {
  const paper = process.env.ALPACA_PAPER !== 'false'
  return new Alpaca({
    keyId: paper
      ? (process.env.ALPACA_PAPER_KEY ?? '')
      : (process.env.ALPACA_API_KEY ?? ''),
    secretKey: paper
      ? (process.env.ALPACA_PAPER_SECRET ?? '')
      : (process.env.ALPACA_API_SECRET ?? ''),
    paper,
  })
}

let _client: AlpacaClient | null = null
function alpaca(): AlpacaClient {
  if (!_client) _client = createClient()
  return _client
}

// ── Symbol conversion ─────────────────────────────────────────────────────────
// OANDA style: EUR_USD  →  Alpaca style: EUR/USD

function toAlpacaSymbol(symbol: string): string {
  return symbol.replace('_', '/')
}

// ── Candle fetching ───────────────────────────────────────────────────────────

type Timeframe = '1Min' | '15Min' | '1Hour' | '4Hour'

const timeframeMs: Record<Timeframe, number> = {
  '1Min':  60_000,
  '15Min': 15 * 60_000,
  '1Hour': 3_600_000,
  '4Hour': 4 * 3_600_000,
}

async function fetchCandles(symbol: string, timeframe: Timeframe, limit = 100): Promise<Candle[]> {
  const bars = await alpaca().getForexBars(toAlpacaSymbol(symbol), {
    timeframe,
    limit,
  }) as Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>

  const ms = timeframeMs[timeframe]
  return bars.map(b => {
    const t = new Date(b.t).getTime()
    return {
      openTime: t,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v,
      closeTime: t + ms,
    }
  })
}

// ── AlpacaAdapter ─────────────────────────────────────────────────────────────

export class AlpacaAdapter implements IMarketAdapter {
  readonly market = 'forex' as const

  async getSnapshot(symbol: string, riskState: RiskState): Promise<MarketSnapshot> {
    const alpacaSymbol = toAlpacaSymbol(symbol)

    const [m1, m15, h1, h4, quote, account, positions] = await Promise.all([
      fetchCandles(symbol, '1Min', 100),
      fetchCandles(symbol, '15Min', 100),
      fetchCandles(symbol, '1Hour', 100),
      fetchCandles(symbol, '4Hour', 100),
      alpaca().getForexLatestQuote(alpacaSymbol) as Promise<{
        bp: number; ap: number
      }>,
      alpaca().getAccount() as Promise<{
        equity: string
        buying_power: string
        portfolio_value: string
        initial_margin: string
      }>,
      alpaca().getPositions() as Promise<Array<{
        symbol: string
        qty: string
        avg_entry_price: string
        side: string
        unrealized_pl: string
        current_price: string
      }>>,
    ])

    const bid = quote.bp ?? 0
    const ask = quote.ap ?? 0
    const mid = (bid + ask) / 2

    // 24h stats derived from H1 candles
    const last24h = h1.slice(-24)
    const high24h = last24h.reduce((m, c) => Math.max(m, c.high), 0)
    const low24h = last24h.reduce((m, c) => Math.min(m, c.low), Infinity)
    const firstOpen = last24h[0]?.open ?? mid
    const changePercent = firstOpen !== 0 ? ((mid - firstOpen) / firstOpen) * 100 : 0
    const totalVolume = last24h.reduce((s, c) => s + c.volume, 0)

    const balances: Balance[] = [
      { asset: 'EQUITY', free: parseFloat(account.equity), locked: parseFloat(account.initial_margin) },
      { asset: 'BUYING_POWER', free: parseFloat(account.buying_power), locked: 0 },
    ]

    const openOrders: Order[] = positions
      .filter(p => !symbol || p.symbol === alpacaSymbol)
      .map(p => ({
        orderId: Date.now(),
        clientOrderId: p.symbol,
        symbol: p.symbol,
        side: p.side === 'long' ? 'BUY' : 'SELL',
        type: 'MARKET',
        price: parseFloat(p.avg_entry_price),
        origQty: Math.abs(parseFloat(p.qty)),
        executedQty: Math.abs(parseFloat(p.qty)),
        status: 'OPEN',
        timeInForce: 'GTC',
        time: Date.now(),
        updateTime: Date.now(),
      }))

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
        swapLong: 0,
        swapShort: 0,
      },
    }
  }

  async getOrderBook(symbol: string, _depth = 20): Promise<OrderBook> {
    const alpacaSymbol = toAlpacaSymbol(symbol)
    const quote = await alpaca().getForexLatestQuote(alpacaSymbol) as {
      bp: number; bs: number; ap: number; as: number
    }
    return {
      symbol,
      bids: [[quote.bp, quote.bs]],
      asks: [[quote.ap, quote.as]],
      timestamp: Date.now(),
    }
  }

  // Alpaca forex does not expose a public trade tape
  async getRecentTrades(_symbol: string, _limit = 50): Promise<Trade[]> {
    return []
  }

  async getBalances(): Promise<Balance[]> {
    const account = await alpaca().getAccount() as {
      equity: string
      buying_power: string
      initial_margin: string
    }
    return [
      { asset: 'EQUITY', free: parseFloat(account.equity), locked: parseFloat(account.initial_margin) },
      { asset: 'BUYING_POWER', free: parseFloat(account.buying_power), locked: 0 },
    ]
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const positions = await alpaca().getPositions() as Array<{
      symbol: string
      qty: string
      avg_entry_price: string
      side: string
    }>
    const alpacaSymbol = symbol ? toAlpacaSymbol(symbol) : undefined
    return positions
      .filter(p => !alpacaSymbol || p.symbol === alpacaSymbol)
      .map(p => ({
        orderId: Date.now(),
        clientOrderId: p.symbol,
        symbol: p.symbol,
        side: p.side === 'long' ? 'BUY' : 'SELL',
        type: 'MARKET',
        price: parseFloat(p.avg_entry_price),
        origQty: Math.abs(parseFloat(p.qty)),
        executedQty: Math.abs(parseFloat(p.qty)),
        status: 'OPEN',
        timeInForce: 'GTC',
        time: Date.now(),
        updateTime: Date.now(),
      }))
  }

  async getTradeHistory(symbol: string, limit = 50): Promise<Fill[]> {
    const alpacaSymbol = toAlpacaSymbol(symbol)
    const activities = await alpaca().getAccountActivities({
      activityTypes: 'FILL',
      pageSize: limit,
    }) as Array<{
      id: string
      symbol: string
      price: string
      qty: string
      side: string
      transaction_time: string
    }>

    return activities
      .filter(a => a.symbol === alpacaSymbol)
      .map(a => ({
        symbol: a.symbol,
        id: parseInt(a.id),
        orderId: parseInt(a.id),
        price: parseFloat(a.price),
        qty: parseFloat(a.qty),
        quoteQty: parseFloat(a.price) * parseFloat(a.qty),
        commission: 0,
        commissionAsset: 'USD',
        time: new Date(a.transaction_time).getTime(),
        isBuyer: a.side === 'buy',
        isMaker: false,
      }))
  }

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    const alpacaSymbol = toAlpacaSymbol(params.symbol)

    const orderReq: Record<string, unknown> = {
      symbol: alpacaSymbol,
      qty: params.quantity,
      side: params.side === 'BUY' ? 'buy' : 'sell',
      type: params.type === 'LIMIT' ? 'limit' : 'market',
      time_in_force: (params.timeInForce ?? 'gtc').toLowerCase(),
      ...(params.type === 'LIMIT' && params.price != null
        ? { limit_price: params.price }
        : {}),
    }

    const order = await alpaca().createOrder(orderReq) as {
      id: string
      client_order_id: string
      symbol: string
      side: string
      type: string
      limit_price: string | null
      qty: string
      status: string
      created_at: string
    }

    return {
      orderId: parseInt(order.id.replace(/-/g, '').slice(0, 9), 16),
      clientOrderId: order.client_order_id,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      price: order.limit_price ? parseFloat(order.limit_price) : (params.price ?? 0),
      origQty: parseFloat(order.qty),
      status: order.status.toUpperCase(),
      transactTime: new Date(order.created_at).getTime(),
    }
  }

  async cancelOrder(_symbol: string, orderId: string | number): Promise<void> {
    await alpaca().cancelOrder(String(orderId))
  }

  async getSpread(symbol: string): Promise<number | null> {
    const alpacaSymbol = toAlpacaSymbol(symbol)
    const quote = await alpaca().getForexLatestQuote(alpacaSymbol) as {
      bp: number; ap: number
    }
    if (!quote) return null
    return toPips(quote.ap - quote.bp, symbol)
  }

  async isMarketOpen(_symbol: string): Promise<boolean> {
    return isForexSessionOpen()
  }
}

export const alpacaAdapter = new AlpacaAdapter()
