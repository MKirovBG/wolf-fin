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
      'Fetch the current market snapshot for a symbol. Returns price, 24h stats, multi-timeframe candles, pre-computed technical indicators (RSI, EMA, ATR, VWAP, BB width), account balances, open orders, risk state, and market context enrichment. ' +
      'NOTE: A fresh snapshot is already pre-fetched and injected at the top of each tick message — only call this tool if you need to re-check conditions AFTER placing an order, or for a different symbol.',
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
      'Place a new order. Guardrails will validate the order against position limits and the daily loss budget before execution. Prefer LIMIT orders to control slippage. For MT5, always specify both stopPips and tpPips to enforce risk:reward discipline at entry time.',
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
        tpPips: { type: 'number', description: 'MT5 only: take-profit distance in pips. Strongly recommended — set TP at entry to enforce R:R discipline.' },
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
  {
    name: 'modify_position',
    description:
      'MT5 only — modify the stop-loss and/or take-profit price of an open position. ' +
      'Use this to: trail a stop (move SL closer to price as trade moves in your favour), ' +
      'move SL to breakeven (set SL = entry price once in profit), or update TP. ' +
      'You MUST provide at least one of sl or tp. Pass 0 to remove a level. ' +
      'Get the ticket from get_open_orders.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticket: { type: 'number', description: 'Position ticket number' },
        market: MARKET_FIELD,
        sl: { type: 'number', description: 'New stop-loss price. Pass 0 to remove existing SL.' },
        tp: { type: 'number', description: 'New take-profit price. Pass 0 to remove existing TP.' },
      },
      required: ['ticket', 'market'],
    },
  },
  {
    name: 'save_memory',
    description: `Persist a trading observation, key price level, pattern, or risk note to long-term memory.
Call this when you discover something worth remembering across future cycles and sessions:
- A support or resistance level that has held multiple times
- A pattern you've observed in this symbol's behaviour
- A risk condition to always watch for
- A session-specific behaviour (e.g. "London open often fades initial move")
Memories are automatically injected into your system prompt each cycle.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', enum: ['pattern', 'risk', 'price_level', 'session', 'general'], description: 'Memory category' },
        key: { type: 'string', description: 'Short unique label, e.g. "1.0800_support" or "london_open_fade"' },
        value: { type: 'string', description: 'What you observed. Be specific and concise (max 200 words).' },
        confidence: { type: 'number', description: 'Your confidence in this observation (0.0 to 1.0)' },
        ttl_hours: { type: 'number', description: 'Optional: expire this memory after N hours. Omit for permanent.' }
      },
      required: ['category', 'key', 'value', 'confidence']
    }
  },
  {
    name: 'read_memories',
    description: `Query your long-term memory for this symbol. Top memories are already injected into your system prompt, but use this tool to search for something specific or to see more entries.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', enum: ['pattern', 'risk', 'price_level', 'session', 'general', 'all'], description: 'Filter by category, or "all"' },
        limit: { type: 'number', description: 'Max memories to return (default 10)' }
      },
      required: []
    }
  },
  {
    name: 'delete_memory',
    description: `Remove a memory that is no longer valid. Use this when a support level breaks, a pattern stops working, or old information would mislead future decisions.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', enum: ['pattern', 'risk', 'price_level', 'session', 'general'] },
        key: { type: 'string', description: 'The key of the memory to delete' }
      },
      required: ['category', 'key']
    }
  },
  {
    name: 'save_plan',
    description: `Write a session trading plan. Use this at the start of a trading session to record your market bias, key levels to watch, and intent for the session. Only one active plan exists per day per agent.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        market_bias: { type: 'string', enum: ['bullish', 'bearish', 'neutral', 'range'], description: 'Your directional bias for this session' },
        key_levels: { type: 'string', description: 'JSON array of key levels: [{price, type, rationale}]. E.g. [{"price":1.0800,"type":"support","rationale":"held 3 times this week"}]' },
        risk_notes: { type: 'string', description: 'Any risk conditions or filters for this session (news, spread, timing)' },
        plan_text: { type: 'string', description: 'Full session plan in plain text: what setups you are looking for, entry conditions, targets' },
        session_label: { type: 'string', description: 'Optional: session name e.g. "London", "New York", "Daily"' }
      },
      required: ['market_bias', 'plan_text']
    }
  },
  {
    name: 'get_plan',
    description: `Retrieve your current active session plan. Call this to check if current market action aligns with your session intent before making a trading decision.`,
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },
  {
    name: 'get_trade_history',
    description:
      'Fetch your recent closed trades (deals) for a symbol. ' +
      'Use this when: (a) a position you opened is no longer showing in get_open_orders — check if it was stopped out or hit TP; ' +
      '(b) you want to review your P&L and exit reasons before sizing a new trade; ' +
      '(c) you suspect an external close happened. ' +
      'Returns entry/exit price, volume, profit/loss, and the exit reason in the comment field ("sl" = stopped out, "tp" = take profit hit, "" = manual/external close).',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Trading pair symbol, e.g. "XAUUSD"' },
        market: MARKET_FIELD,
        days: { type: 'number', description: 'How many days back to look (default 1, max 7)' },
        limit: { type: 'number', description: 'Max deals to return (default 20)' },
      },
      required: ['symbol', 'market'],
    },
  },
]

const TRADING_ONLY_TOOLS = new Set(['place_order', 'close_position', 'cancel_order', 'modify_position'])

/** Returns the tool list for the given market, excluding tools unsupported by that market.
 *  When cycleType is 'planning', trading execution tools are excluded. */
export function getTools(market: 'crypto' | 'mt5', cycleType?: 'trading' | 'planning'): Anthropic.Tool[] {
  let tools = ALL_TOOLS

  if (market === 'mt5') {
    // Exclude order_book (MT5 retail brokers don't publish DOM)
    // Include close_position (MT5 uses ticket-based closes, NOT opposite-side orders)
    tools = tools.filter(t => t.name !== 'get_order_book')
  } else {
    // Crypto: exclude MT5-specific tools
    tools = tools.filter(t => t.name !== 'close_position' && t.name !== 'get_trade_history')
  }

  if (cycleType === 'planning') {
    tools = tools.filter(t => !TRADING_ONLY_TOOLS.has(t.name))
  }

  return tools
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

export interface GetTradeHistoryInput {
  symbol: string
  market: 'crypto' | 'mt5'
  days?: number
  limit?: number
}
