// Wolf-Fin Adapter Types — shared domain types for the trading agent

export interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  closeTime: number
}

export interface Balance {
  asset: string
  free: number
  locked: number
}

export interface Order {
  orderId: number
  clientOrderId: string
  symbol: string
  side: 'BUY' | 'SELL'
  type: string
  price: number
  origQty: number
  executedQty: number
  status: string
  timeInForce: string
  time: number
  updateTime: number
  // MT5-specific (optional — only present for MT5 open positions)
  profit?: number        // broker-computed unrealized P&L in account currency
  swap?: number          // accrued overnight swap
  sl?: number            // stop-loss price (0 = none)
  tp?: number            // take-profit price (0 = none)
  priceCurrent?: number  // current market price of the position
}

export interface Fill {
  symbol: string
  id: number
  orderId: number
  price: number
  qty: number
  quoteQty: number
  commission: number
  commissionAsset: string
  time: number
  isBuyer: boolean
  isMaker: boolean
}

export interface OrderBook {
  symbol: string
  bids: [number, number][] // [price, qty]
  asks: [number, number][]
  timestamp: number
}

export interface Trade {
  id: number
  price: number
  qty: number
  time: number
  isBuyerMaker: boolean
}

export interface Indicators {
  rsi14: number
  ema20: number
  ema50: number
  atr14: number
  vwap: number
  bbWidth: number
}

export interface RiskState {
  dailyPnlUsd: number
  remainingBudgetUsd: number
  positionNotionalUsd: number
}

// ── Key Levels (Support / Resistance / Pivots) ───────────────────────────────

export interface KeyLevel {
  price: number
  type: 'resistance' | 'support' | 'pivot' | 'swing_high' | 'swing_low'
  source: string   // e.g. 'daily_high', 'weekly_pivot', 'swing_h1'
  strength: number // 1 = minor, 2 = moderate, 3 = major
}

// ── Enrichment / Market Context ───────────────────────────────────────────────

export interface MarketContext {
  /** Crypto sentiment index 0-100, only present for crypto market */
  fearGreed?: { value: number; classification: string }
  /** Top news headlines for the symbol from CryptoPanic */
  news?: { headline: string; votes: number; url: string }[]
  /** Upcoming high-impact economic events within the next 2 hours */
  upcomingEvents?: { name: string; country: string; impact: string; time: number }[]
  /** Macro crypto market data from CoinGecko */
  cryptoMarket?: { btcDominance: number; totalMarketCapUsd: number }
  /** Recent forex news headlines with sentiment tags — only present for mt5 market */
  forexNews?: { headline: string; sentiment: 'bullish' | 'bearish' | 'neutral'; source: string; url: string }[]
}

// ── Market Snapshot ───────────────────────────────────────────────────────────

export interface MarketSnapshot {
  symbol: string
  timestamp: number
  market: 'crypto' | 'forex' | 'mt5'
  price: {
    bid: number
    ask: number
    last: number
  }
  stats24h: {
    volume: number
    changePercent: number
    high: number
    low: number
  }
  candles: {
    m1: Candle[]
    m15: Candle[]
    h1: Candle[]
    h4: Candle[]
  }
  indicators: Indicators
  account: {
    balances: Balance[]
    openOrders: Order[]
  }
  risk: RiskState
  /** Enrichment signals assembled by context.ts */
  context?: MarketContext
  /** Forex-specific fields — only present when market === 'forex' or 'mt5' */
  forex?: {
    spread: number       // ask - bid in pips
    pipValue: number     // USD per pip per standard lot
    point: number        // minimum price increment (0.0001 forex, 0.01 gold, 0.01 JPY crosses)
    sessionOpen: boolean // is market in an active session?
    swapLong: number     // overnight swap rate long
    swapShort: number    // overnight swap rate short
  }
  /** MT5-specific: rich open position details (sl, tp, profit, swap, priceCurrent) */
  positions?: Record<string, unknown>[]
  /** MT5-specific: pending limit/stop orders not yet filled */
  pendingOrders?: Record<string, unknown>[]
  /** MT5-specific: live account financials (balance, equity, margin, leverage) */
  accountInfo?: {
    balance: number
    equity: number
    freeMargin: number
    usedMargin: number
    leverage: number
  }
  /** Auto-computed support/resistance/pivot levels — sorted by proximity to current price */
  keyLevels?: KeyLevel[]
}

// ── Order Types ───────────────────────────────────────────────────────────────

export interface OrderParams {
  symbol: string
  side: 'BUY' | 'SELL'
  type: 'LIMIT' | 'MARKET'
  quantity: number
  price?: number           // required for LIMIT
  timeInForce?: 'GTC' | 'IOC' | 'FOK'
  stopPips?: number        // forex only: stop-loss distance in pips
  stopPrice?: number       // computed absolute stop price (set by agent before calling placeOrder)
}

export interface OrderResult {
  orderId: number
  clientOrderId: string
  symbol: string
  side: 'BUY' | 'SELL'
  type: string
  price: number
  origQty: number
  status: string
  transactTime: number
}
