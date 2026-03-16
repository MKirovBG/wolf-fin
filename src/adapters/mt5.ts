// Wolf-Fin MT5 Adapter — calls the Python mt5-bridge over localhost HTTP

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

// ── Bridge HTTP helpers ──────────────────────────────────────────────────────

const BASE = () => `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`

async function mt5Get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE()}${path}`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`MT5 bridge ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

async function mt5Post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`MT5 bridge ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ── Symbol conversion ────────────────────────────────────────────────────────

function toMt5Symbol(s: string): string {
  return s.toUpperCase().replace(/_/g, '')
}

function fromMt5Symbol(s: string): string {
  // 6-char all-alpha → forex pair: EURUSD → EUR_USD
  if (s.length === 6 && /^[A-Z]{6}$/.test(s)) {
    return `${s.slice(0, 3)}_${s.slice(3)}`
  }
  return s
}

// ── Pip helpers (use MT5 symbol info when available, fallback to heuristic) ──

function pipSizeHeuristic(symbol: string): number {
  return symbol.toUpperCase().includes('JPY') ? 0.01 : 0.0001
}

// ── Bridge response types ────────────────────────────────────────────────────

interface BridgeCandle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  closeTime: number
}

interface BridgePosition {
  ticket: number
  symbol: string
  side: 'BUY' | 'SELL'
  volume: number
  priceOpen: number
  priceCurrent: number
  profit: number
  swap: number
  sl: number
  tp: number
  magic: number
  comment: string
  time: string
}

interface BridgeSnapshot {
  symbol: string
  price: { bid: number; ask: number; last: number }
  candles: {
    m1: BridgeCandle[]
    m15: BridgeCandle[]
    h1: BridgeCandle[]
    h4: BridgeCandle[]
  }
  symbol_info: {
    spread: number
    point: number
    digits: number
    swap_long: number
    swap_short: number
    trade_mode: number
    volume_min: number
    volume_max: number
    volume_step: number
    trade_contract_size: number
    session_open: boolean
  }
  account: {
    balance: number
    equity: number
    margin: number
    free_margin: number
    profit: number
    leverage: number
    login: number
    server: string
  }
  positions: BridgePosition[]
}

interface BridgeAccount {
  login: number
  server: string
  trade_mode: number
  balance: number
  equity: number
  margin: number
  free_margin: number
  profit: number
  leverage: number
  currency: string
  name: string
  company: string
}

interface BridgeDeal {
  ticket: number
  order: number
  symbol: string
  type: number
  volume: number
  price: number
  profit: number
  commission: number
  swap: number
  fee: number
  magic: number
  comment: string
  time: string
}

interface BridgeOrderResult {
  retcode: number
  deal: number
  order: number
  volume: number
  price: number
  comment: string
}

interface BridgeTrade {
  price: number
  volume: number
  time: number
  isBuyerMaker: boolean
}

interface BridgeBookEntry {
  0: number
  1: number
}

// ── MT5Adapter ───────────────────────────────────────────────────────────────

export class MT5Adapter implements IMarketAdapter {
  readonly market = 'mt5' as const

  async getSnapshot(symbol: string, riskState: RiskState): Promise<MarketSnapshot> {
    const snap = await mt5Get<BridgeSnapshot>(`/snapshot/${toMt5Symbol(symbol)}`)

    const mapCandles = (arr: BridgeCandle[]): Candle[] =>
      arr.map(c => ({
        openTime: c.openTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        closeTime: c.closeTime,
      }))

    const m1 = mapCandles(snap.candles.m1)
    const m15 = mapCandles(snap.candles.m15)
    const h1 = mapCandles(snap.candles.h1)
    const h4 = mapCandles(snap.candles.h4)

    const { bid, ask, last } = snap.price
    const mid = last || (bid + ask) / 2

    // 24h stats from H1 candles
    const last24h = h1.slice(-24)
    const high24h = last24h.reduce((m, c) => Math.max(m, c.high), 0)
    const low24h = last24h.reduce((m, c) => Math.min(m, c.low), Infinity)
    const firstOpen = last24h[0]?.open ?? mid
    const changePercent = firstOpen !== 0 ? ((mid - firstOpen) / firstOpen) * 100 : 0
    const totalVolume = last24h.reduce((s, c) => s + c.volume, 0)

    const info = snap.symbol_info
    const point = info.point || pipSizeHeuristic(symbol)

    // Map account
    const balances: Balance[] = [
      { asset: 'EQUITY', free: snap.account.equity, locked: snap.account.margin },
      { asset: 'BALANCE', free: snap.account.balance, locked: 0 },
      { asset: 'FREE_MARGIN', free: snap.account.free_margin, locked: 0 },
    ]

    // Map positions to open orders
    const openOrders: Order[] = snap.positions.map(p => ({
      orderId: p.ticket,
      clientOrderId: `mt5-${p.ticket}`,
      symbol: p.symbol,
      side: p.side,
      type: 'MARKET',
      price: p.priceOpen,
      origQty: p.volume,
      executedQty: p.volume,
      status: 'OPEN',
      timeInForce: 'GTC',
      time: new Date(p.time).getTime(),
      updateTime: Date.now(),
    }))

    // Pip value: for standard forex, point * contract_size
    // For 6-char forex pairs: pipValue = point * contractSize (e.g. 0.0001 * 100000 = 10 USD per lot)
    const contractSize = info.trade_contract_size || 100_000
    const pipValue = point * contractSize

    return {
      symbol: fromMt5Symbol(snap.symbol) || symbol,
      timestamp: Date.now(),
      market: 'mt5',
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
        spread: info.spread * point / pipSizeHeuristic(symbol),
        pipValue,
        sessionOpen: info.session_open,
        swapLong: info.swap_long,
        swapShort: info.swap_short,
      },
    }
  }

  async getOrderBook(symbol: string, depth = 20): Promise<OrderBook> {
    const data = await mt5Get<{ symbol: string; bids: number[][]; asks: number[][]; timestamp: number }>(
      `/orderbook/${toMt5Symbol(symbol)}?depth=${depth}`,
    )
    return {
      symbol,
      bids: data.bids.map((b): [number, number] => [b[0], b[1]]),
      asks: data.asks.map((a): [number, number] => [a[0], a[1]]),
      timestamp: data.timestamp,
    }
  }

  async getRecentTrades(symbol: string, limit = 50): Promise<Trade[]> {
    const data = await mt5Get<{ trades: BridgeTrade[] }>(
      `/trades/${toMt5Symbol(symbol)}?count=${limit}`,
    )
    return data.trades.map((t, i) => ({
      id: i,
      price: t.price,
      qty: t.volume,
      time: t.time,
      isBuyerMaker: t.isBuyerMaker,
    }))
  }

  async getBalances(): Promise<Balance[]> {
    const acct = await mt5Get<BridgeAccount>('/account')
    return [
      { asset: 'EQUITY', free: acct.equity, locked: acct.margin },
      { asset: 'BALANCE', free: acct.balance, locked: 0 },
      { asset: 'FREE_MARGIN', free: acct.free_margin, locked: 0 },
    ]
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const path = symbol ? `/positions?symbol=${toMt5Symbol(symbol)}` : '/positions'
    const positions = await mt5Get<BridgePosition[]>(path)
    return positions.map(p => ({
      orderId: p.ticket,
      clientOrderId: `mt5-${p.ticket}`,
      symbol: fromMt5Symbol(p.symbol),
      side: p.side,
      type: 'MARKET',
      price: p.priceOpen,
      origQty: p.volume,
      executedQty: p.volume,
      status: 'OPEN',
      timeInForce: 'GTC',
      time: new Date(p.time).getTime(),
      updateTime: Date.now(),
    }))
  }

  async getTradeHistory(symbol: string, limit = 50): Promise<Fill[]> {
    const deals = await mt5Get<BridgeDeal[]>(
      `/history/deals?symbol=${toMt5Symbol(symbol)}&limit=${limit}`,
    )
    return deals.map(d => ({
      symbol: fromMt5Symbol(d.symbol),
      id: d.ticket,
      orderId: d.order,
      price: d.price,
      qty: d.volume,
      quoteQty: d.price * d.volume,
      commission: d.commission,
      commissionAsset: 'USD',
      time: new Date(d.time).getTime(),
      isBuyer: d.type === 0, // DEAL_TYPE_BUY
      isMaker: false,
    }))
  }

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    const magic = parseInt(process.env.MT5_MAGIC ?? '123456')
    const deviation = parseInt(process.env.MT5_DEVIATION ?? '10')

    const body: Record<string, unknown> = {
      symbol: toMt5Symbol(params.symbol),
      action: params.side,
      order_type: params.type,
      volume: params.quantity,
      deviation,
      magic,
      comment: 'wolf-fin',
    }

    if (params.price != null) body.price = params.price

    // Compute stop-loss from stopPips if provided
    if (params.stopPrice != null) {
      body.sl = params.stopPrice
    } else if (params.stopPips != null && params.price != null) {
      const pipSz = pipSizeHeuristic(params.symbol)
      body.sl = params.side === 'BUY'
        ? params.price - params.stopPips * pipSz
        : params.price + params.stopPips * pipSz
    }

    const result = await mt5Post<BridgeOrderResult>('/order', body)

    return {
      orderId: result.order,
      clientOrderId: `mt5-${result.deal}`,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      price: result.price,
      origQty: result.volume,
      status: 'FILLED',
      transactTime: Date.now(),
    }
  }

  async cancelOrder(_symbol: string, orderId: string | number): Promise<void> {
    // Try closing as position first, then as pending order
    try {
      await mt5Post('/order/close', { ticket: Number(orderId) })
    } catch {
      await mt5Post('/order/cancel', { ticket: Number(orderId) })
    }
  }

  async getSpread(symbol: string): Promise<number | null> {
    const info = await mt5Get<{ spread: number; point: number }>(
      `/symbol-info/${toMt5Symbol(symbol)}`,
    )
    const pipSz = pipSizeHeuristic(symbol)
    return (info.spread * info.point) / pipSz
  }

  async isMarketOpen(symbol: string): Promise<boolean> {
    const info = await mt5Get<{ trade_mode: number }>(
      `/symbol-info/${toMt5Symbol(symbol)}`,
    )
    // trade_mode: 0 = SYMBOL_TRADE_MODE_DISABLED, others = various trade modes
    // In practice, trade_mode > 0 means trading is allowed
    return info.trade_mode > 0
  }
}

export const mt5Adapter = new MT5Adapter()
