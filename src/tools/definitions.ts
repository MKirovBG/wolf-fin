// Wolf-Fin Tool Definitions — Anthropic tool schemas for the trading agent

import Anthropic from '@anthropic-ai/sdk'

// ── Tool input schemas ────────────────────────────────────────────────────────

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_snapshot',
    description:
      'Fetch the current market snapshot for a symbol. Returns price, 24h stats, multi-timeframe candles, pre-computed technical indicators (RSI, EMA, ATR, VWAP, BB width), account balances, open orders, and risk state.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol, e.g. "BTCUSDT"',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_order_book',
    description:
      'Fetch the current order book for a symbol. Use this to assess liquidity and estimate slippage before sizing an order.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol, e.g. "BTCUSDT"',
        },
        depth: {
          type: 'number',
          description: 'Number of bid/ask levels to return (default 20, max 100)',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_recent_trades',
    description:
      'Fetch the most recent public trades for a symbol. Use this to read tape momentum — who is aggressive, buyer or seller.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol, e.g. "BTCUSDT"',
        },
        limit: {
          type: 'number',
          description: 'Number of trades to return (default 50, max 1000)',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_open_orders',
    description:
      'Fetch all currently open orders for a symbol (or all symbols if omitted). Use this to review existing positions before making new decisions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: {
          type: 'string',
          description: 'Optional trading pair symbol filter, e.g. "BTCUSDT"',
        },
      },
      required: [],
    },
  },
  {
    name: 'place_order',
    description:
      'Place a new spot order. Guardrails will validate the order against position limits and the daily loss budget before execution. Prefer LIMIT orders to control slippage.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol, e.g. "BTCUSDT"',
        },
        side: {
          type: 'string',
          enum: ['BUY', 'SELL'],
          description: 'Order direction',
        },
        type: {
          type: 'string',
          enum: ['LIMIT', 'MARKET'],
          description: 'Order type. Use LIMIT unless speed is critical.',
        },
        quantity: {
          type: 'number',
          description: 'Base asset quantity to buy or sell',
        },
        price: {
          type: 'number',
          description: 'Limit price (required for LIMIT orders)',
        },
        timeInForce: {
          type: 'string',
          enum: ['GTC', 'IOC', 'FOK'],
          description: 'Time in force for LIMIT orders (default GTC)',
        },
      },
      required: ['symbol', 'side', 'type', 'quantity'],
    },
  },
  {
    name: 'cancel_order',
    description: 'Cancel an existing open order by orderId.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol, e.g. "BTCUSDT"',
        },
        orderId: {
          type: 'number',
          description: 'The numeric order ID to cancel',
        },
      },
      required: ['symbol', 'orderId'],
    },
  },
]

// ── Tool input types ──────────────────────────────────────────────────────────
// These mirror the input_schema shapes above for use in the tool handler.

export interface GetSnapshotInput {
  symbol: string
}

export interface GetOrderBookInput {
  symbol: string
  depth?: number
}

export interface GetRecentTradesInput {
  symbol: string
  limit?: number
}

export interface GetOpenOrdersInput {
  symbol?: string
}

export interface PlaceOrderInput {
  symbol: string
  side: 'BUY' | 'SELL'
  type: 'LIMIT' | 'MARKET'
  quantity: number
  price?: number
  timeInForce?: 'GTC' | 'IOC' | 'FOK'
}

export interface CancelOrderInput {
  symbol: string
  orderId: number
}
