// Wolf-Fin Tool Definitions — Anthropic tool schemas for the trading agent

import Anthropic from '@anthropic-ai/sdk'

// ── Tool input schemas ────────────────────────────────────────────────────────

const MARKET_FIELD = {
  type: 'string',
  enum: ['crypto', 'forex', 'mt5'],
  description: 'Market type. "crypto" routes to Binance, "forex" routes to Alpaca, "mt5" routes to MetaTrader 5.',
} as const

const ALL_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_snapshot',
    description:
      'Fetch the current market snapshot for a symbol. Returns price, 24h stats, multi-timeframe candles, pre-computed technical indicators (RSI, EMA, ATR, VWAP, BB width), account balances, open orders, risk state, and market context enrichment.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Trading pair symbol, e.g. "BTCUSDT" or "EUR_USD"' },
        market: MARKET_FIELD,
      },
      required: ['symbol', 'market'],
    },
  },
  {
    name: 'get_order_book',
    description:
      'Fetch the current order book for a symbol. Use this to assess liquidity and estimate slippage before sizing an order.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Trading pair symbol' },
        market: MARKET_FIELD,
        depth: { type: 'number', description: 'Number of bid/ask levels to return (default 20, max 100)' },
      },
      required: ['symbol', 'market'],
    },
  },
  {
    name: 'get_recent_trades',
    description:
      'Fetch the most recent public trades for a symbol. Use this to read tape momentum — who is aggressive, buyer or seller.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Trading pair symbol' },
        market: MARKET_FIELD,
        limit: { type: 'number', description: 'Number of trades to return (default 50, max 1000)' },
      },
      required: ['symbol', 'market'],
    },
  },
  {
    name: 'get_open_orders',
    description:
      'Fetch all currently open orders for a symbol (or all symbols if omitted). Use this to review existing positions before making new decisions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Optional trading pair symbol filter' },
        market: MARKET_FIELD,
      },
      required: ['market'],
    },
  },
  {
    name: 'place_order',
    description:
      'Place a new order. Guardrails will validate the order against position limits and the daily loss budget before execution. Prefer LIMIT orders to control slippage. For forex, always specify stopPips.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Trading pair symbol, e.g. "BTCUSDT" or "EUR_USD"' },
        market: MARKET_FIELD,
        side: { type: 'string', enum: ['BUY', 'SELL'], description: 'Order direction' },
        type: { type: 'string', enum: ['LIMIT', 'MARKET'], description: 'Order type. Use LIMIT unless speed is critical.' },
        quantity: { type: 'number', description: 'Base asset quantity (units for forex, e.g. 1000 = micro-lot)' },
        price: { type: 'number', description: 'Limit price (required for LIMIT orders)' },
        timeInForce: { type: 'string', enum: ['GTC', 'IOC', 'FOK'], description: 'Time in force for LIMIT orders (default GTC)' },
        stopPips: { type: 'number', description: 'Forex only: stop-loss distance in pips. Required for forex orders.' },
      },
      required: ['symbol', 'market', 'side', 'type', 'quantity'],
    },
  },
  {
    name: 'cancel_order',
    description: 'Cancel an existing open order by orderId.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Trading pair symbol' },
        market: MARKET_FIELD,
        orderId: { type: 'number', description: 'The numeric order ID to cancel' },
      },
      required: ['symbol', 'market', 'orderId'],
    },
  },
]

/** Returns the tool list for the given market, excluding tools unsupported by that market. */
export function getTools(market: 'crypto' | 'forex' | 'mt5'): Anthropic.Tool[] {
  // MT5 retail brokers (e.g. Equiti) do not publish DOM data — exclude get_order_book
  if (market === 'mt5') return ALL_TOOLS.filter(t => t.name !== 'get_order_book')
  return ALL_TOOLS
}

// ── Tool input types ──────────────────────────────────────────────────────────

export interface GetSnapshotInput {
  symbol: string
  market: 'crypto' | 'forex' | 'mt5'
}

export interface GetOrderBookInput {
  symbol: string
  market: 'crypto' | 'forex' | 'mt5'
  depth?: number
}

export interface GetRecentTradesInput {
  symbol: string
  market: 'crypto' | 'forex' | 'mt5'
  limit?: number
}

export interface GetOpenOrdersInput {
  symbol?: string
  market: 'crypto' | 'forex' | 'mt5'
}

export interface PlaceOrderInput {
  symbol: string
  market: 'crypto' | 'forex' | 'mt5'
  side: 'BUY' | 'SELL'
  type: 'LIMIT' | 'MARKET'
  quantity: number
  price?: number
  timeInForce?: 'GTC' | 'IOC' | 'FOK'
  stopPips?: number
}

export interface CancelOrderInput {
  symbol: string
  market: 'crypto' | 'forex' | 'mt5'
  orderId: number
}
