// Wolf-Fin Tool Definitions — Anthropic tool schemas for the trading agent

import Anthropic from '@anthropic-ai/sdk'

// ── Tool input schemas ────────────────────────────────────────────────────────

const MARKET_FIELD = {
  type: 'string',
  enum: ['crypto', 'mt5'],
  description: 'Market type. "crypto" routes to Binance, "mt5" routes to MetaTrader 5.',
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
      'Place a new order. Guardrails will validate the order against position limits and the daily loss budget before execution. Prefer LIMIT orders to control slippage. For MT5, always specify stopPips.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Trading pair symbol, e.g. "BTCUSDT" or "EUR_USD"' },
        market: MARKET_FIELD,
        side: { type: 'string', enum: ['BUY', 'SELL'], description: 'Order direction' },
        type: { type: 'string', enum: ['LIMIT', 'MARKET'], description: 'Order type. Use LIMIT unless speed is critical.' },
        quantity: { type: 'number', description: 'Base asset quantity (crypto: units; MT5: lots, e.g. 0.01 = micro-lot)' },
        price: { type: 'number', description: 'Limit price (required for LIMIT orders)' },
        timeInForce: { type: 'string', enum: ['GTC', 'IOC', 'FOK'], description: 'Time in force for LIMIT orders (default GTC)' },
        stopPips: { type: 'number', description: 'MT5 only: stop-loss distance in pips. Required for MT5 orders.' },
      },
      required: ['symbol', 'market', 'side', 'type', 'quantity'],
    },
  },
  {
    name: 'cancel_order',
    description: 'Cancel a pending limit or stop order by orderId. For MT5: use this ONLY for pending orders (visible in the Orders tab). To close an already-open position use close_position instead.',
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
  {
    name: 'close_position',
    description:
      'MT5 only — close an open position by its ticket number. Use this to take profit, cut a loss, or exit any open trade. ' +
      'Get the ticket from get_open_orders (the orderId field). ' +
      'NEVER use place_order with the opposite side to close a position — that opens a second trade instead of closing the existing one. ' +
      'Optionally specify volume for a partial close.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticket:  { type: 'number', description: 'Position ticket number (orderId from get_open_orders)' },
        market:  MARKET_FIELD,
        volume:  { type: 'number', description: 'Volume to close in lots (omit to close the full position)' },
      },
      required: ['ticket', 'market'],
    },
  },
]

/** Returns the tool list for the given market, excluding tools unsupported by that market. */
export function getTools(market: 'crypto' | 'mt5'): Anthropic.Tool[] {
  if (market === 'mt5') {
    // Exclude order_book (MT5 retail brokers don't publish DOM)
    // Include close_position (MT5 uses ticket-based closes, NOT opposite-side orders)
    return ALL_TOOLS.filter(t => t.name !== 'get_order_book')
  }
  // Crypto: exclude close_position (use place_order sell to exit a long)
  return ALL_TOOLS.filter(t => t.name !== 'close_position')
}

// ── Tool input types ──────────────────────────────────────────────────────────

export interface GetSnapshotInput {
  symbol: string
  market: 'crypto' | 'mt5'
}

export interface GetOrderBookInput {
  symbol: string
  market: 'crypto' | 'mt5'
  depth?: number
}

export interface GetRecentTradesInput {
  symbol: string
  market: 'crypto' | 'mt5'
  limit?: number
}

export interface GetOpenOrdersInput {
  symbol?: string
  market: 'crypto' | 'mt5'
}

export interface PlaceOrderInput {
  symbol: string
  market: 'crypto' | 'mt5'
  side: 'BUY' | 'SELL'
  type: 'LIMIT' | 'MARKET'
  quantity: number
  price?: number
  timeInForce?: 'GTC' | 'IOC' | 'FOK'
  stopPips?: number
}

export interface CancelOrderInput {
  symbol: string
  market: 'crypto' | 'mt5'
  orderId: number
}

export interface ClosePositionInput {
  ticket: number
  market: 'crypto' | 'mt5'
  volume?: number
}
