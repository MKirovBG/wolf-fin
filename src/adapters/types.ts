// Wolf-Fin Adapter Types

export interface Candle {
  openTime:  number
  open:      number
  high:      number
  low:       number
  close:     number
  volume:    number
  closeTime: number
}

export interface Indicators {
  rsi14?:    number
  ema20?:    number
  ema50?:    number
  atr14?:    number
  vwap?:     number
  bbWidth?:  number
  mtf?:      MTFIndicators
  macd?:     { macd: number; signal: number; histogram: number }
  adx?:      { adx: number; plusDI: number; minusDI: number }
  stoch?:    { k: number; d: number }
  psar?:     { value: number; bullish: boolean }
  ichimoku?: { conversion: number; base: number; spanA: number; spanB: number; aboveCloud: boolean; cloudBullish: boolean }
  cci?:        number
  williamsR?:  number
  obv?:        { value: number; rising: boolean }
  mfi?:        number
  keltner?:    { upper: number; middle: number; lower: number }
  divergence?: { rsi?: 'bullish' | 'bearish'; macd?: 'bullish' | 'bearish' }
  fib?:        Array<{ price: number; label: string }>
}

export interface TFIndicators {
  rsi14: number
  ema20: number
  ema50?: number
  atr14: number
}

export interface MTFIndicators {
  m15?: TFIndicators
  h4?:  TFIndicators
  confluence: number
}

export interface KeyLevel {
  price:    number
  type:     'resistance' | 'support' | 'pivot' | 'swing_high' | 'swing_low'
  source:   string
  strength: number
}

// ── Execution / account types (used internally by MT5Adapter) ────────────────

export interface Balance {
  asset:  string
  free:   number
  locked: number
}

export interface Order {
  orderId:        number
  clientOrderId:  string
  symbol:         string
  side:           'BUY' | 'SELL'
  type:           string
  price:          number
  origQty:        number
  executedQty:    number
  status:         string
  timeInForce:    string
  time:           number
  updateTime:     number
  [key: string]:  unknown
}

export interface Fill {
  symbol:          string
  id:              number
  orderId:         number
  price:           number
  qty:             number
  quoteQty:        number
  commission:      number
  commissionAsset: string
  time:            number
  isBuyer:         boolean
  isMaker:         boolean
}

export interface Trade {
  id:            number
  price:         number
  qty:           number
  time:          number
  isBuyerMaker:  boolean
}

export interface OrderBook {
  symbol:    string
  bids:      [number, number][]
  asks:      [number, number][]
  timestamp: number
}

export interface RiskState {
  dailyPnlUsd:       number
  remainingBudgetUsd: number
  openPositionCount:  number
  openPositionValue:  number
}

export interface MarketSnapshot {
  symbol:      string
  timestamp:   number
  market:      string
  price:       { bid: number; ask: number; last: number }
  stats24h:    { volume: number; changePercent: number; high: number; low: number }
  candles:     { m1: Candle[]; m5: Candle[]; m15: Candle[]; m30: Candle[]; h1: Candle[]; h4: Candle[] }
  indicators:  Record<string, unknown>
  account:     { balances: Balance[]; openOrders: Order[] }
  positions?:  unknown[]
  pendingOrders?: unknown[]
  risk:        RiskState
  accountInfo: { balance: number; equity: number; freeMargin: number; usedMargin: number; leverage: number }
  forex?:      Record<string, unknown>
  keyLevels:   KeyLevel[]
}

export interface OrderParams {
  symbol:      string
  side:        'BUY' | 'SELL'
  type:        'LIMIT' | 'MARKET'
  quantity:    number
  price?:      number
  timeInForce?: 'GTC' | 'IOC' | 'FOK'
  stopPips?:   number
  stopPrice?:  number
  tpPips?:     number
  tpPrice?:    number
}

export interface OrderResult {
  orderId:       number
  clientOrderId: string
  symbol:        string
  side:          'BUY' | 'SELL'
  type:          string
  price:         number
  origQty:       number
  status:        string
  transactTime:  number
}
