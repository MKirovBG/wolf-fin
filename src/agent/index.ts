// Wolf-Fin Agent — core agentic trading loop

import Anthropic from '@anthropic-ai/sdk'
import pino from 'pino'
import { getAdapter } from '../adapters/registry.js'
import { getRiskState, isDailyLimitHit } from '../guardrails/riskState.js'
import { updatePositionNotionalFor, isDailyLimitHitFor, setForexContext } from '../guardrails/riskStateStore.js'
import { validateOrder } from '../guardrails/validate.js'
import { validateForexOrder } from '../guardrails/forex.js'
import { getForexContext } from '../guardrails/riskStateStore.js'
import { buildMarketContext } from './context.js'
import { sessionLabel } from '../adapters/session.js'
import { TOOLS } from '../tools/definitions.js'
import { recordCycle } from '../server/state.js'
import type { OrderParams } from '../adapters/types.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

const anthropic = new Anthropic()

// ── Config ────────────────────────────────────────────────────────────────────

export interface AgentConfig {
  symbol: string
  market: 'crypto' | 'forex'
  /** Override paper-trading mode. Defaults to env PAPER_TRADING !== 'false'. */
  paper?: boolean
  /** Maximum tool-call iterations before the cycle is aborted. Default: 10. */
  maxIterations?: number
}

function isPaperMode(config: AgentConfig): boolean {
  if (config.paper !== undefined) return config.paper
  return process.env.PAPER_TRADING !== 'false'
}

// ── System Prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(market: 'crypto' | 'forex', paper: boolean): string {
  const mode = paper ? '[PAPER TRADING — no real orders will be sent]' : '[LIVE TRADING]'
  const sessionNote =
    market === 'forex'
      ? `\nCURRENT SESSION: ${sessionLabel()}\nFOREX SESSION RULES: Only trade during Tokyo, London, or New York sessions. Avoid Sydney-only hours. Reject entries when spread > 3 pips or sessionOpen is false.`
      : ''

  return `You are Wolf-Fin, an autonomous trading agent. ${mode}

ROLE: Disciplined, risk-first algorithmic trader. Make exactly one trading decision per cycle — HOLD, BUY, SELL, or CANCEL — based on technical evidence and market context.

PROCESS:
1. Call get_snapshot to get price, indicators, balances, open orders, and risk state.
2. Optionally call get_order_book to assess liquidity before sizing.
3. Reason through the evidence: trend (EMA cross), momentum (RSI), volatility (ATR, BB width), context signals.
4. Decide: HOLD / BUY qty @ price / SELL qty @ price / CANCEL orderId.
5. Execute via place_order or cancel_order. Always prefer LIMIT orders.
${market === 'forex' ? '6. Forex: always include stopPips on every order (ATR-based distance).' : ''}
RISK RULES (non-negotiable):
- If the daily loss limit is hit (remainingBudgetUsd = 0), HOLD unconditionally.
- Size so that a stop-out costs at most 1% of NAV.
- Do not pyramid an open position unless RSI and EMA both confirm.
- Never risk more than remainingBudgetUsd on a single trade.
${sessionNote}

DECISION FORMAT (append after tool calls):
  DECISION: [HOLD | BUY <qty> @ <price> | SELL <qty> @ <price> | CANCEL <orderId>]
  REASON: <1-2 sentences of evidence>`
}

// ── Tool Dispatcher ───────────────────────────────────────────────────────────

async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  defaultMarket: 'crypto' | 'forex',
  paper: boolean,
): Promise<unknown> {
  const market = (input.market as 'crypto' | 'forex' | undefined) ?? defaultMarket
  const adapter = getAdapter(market)

  switch (name) {
    case 'get_snapshot': {
      const riskState = getRiskState()
      const snap = await adapter.getSnapshot(input.symbol as string, riskState)
      snap.context = await buildMarketContext(input.symbol as string, market)
      // Keep per-market position notional in sync for risk calculations
      const openNotional = snap.account.openOrders.reduce(
        (sum, o) => sum + o.price * o.origQty,
        0,
      )
      updatePositionNotionalFor(market, openNotional)
      // Cache forex context so place_order validation can use it
      if (market === 'forex' && snap.forex) {
        setForexContext({
          spread: snap.forex.spread,
          sessionOpen: snap.forex.sessionOpen,
          pipValue: snap.forex.pipValue,
        })
      }
      return snap
    }

    case 'get_order_book':
      return adapter.getOrderBook(input.symbol as string, input.depth as number | undefined)

    case 'get_recent_trades':
      return adapter.getRecentTrades(input.symbol as string, input.limit as number | undefined)

    case 'get_open_orders':
      return adapter.getOpenOrders(input.symbol as string | undefined)

    case 'place_order': {
      const params: OrderParams = {
        symbol: input.symbol as string,
        side: input.side as 'BUY' | 'SELL',
        type: input.type as 'LIMIT' | 'MARKET',
        quantity: input.quantity as number,
        price: input.price as number | undefined,
        timeInForce: input.timeInForce as 'GTC' | 'IOC' | 'FOK' | undefined,
        stopPips: input.stopPips as number | undefined,
      }

      const validation =
        market === 'forex'
          ? (() => {
              const fx = getForexContext()
              return validateForexOrder(params, fx.spread, fx.sessionOpen, fx.pipValue)
            })()
          : validateOrder(params, params.price ?? 0)

      if (!validation.ok) {
        log.warn({ reason: validation.reason }, 'order blocked by guardrails')
        return { blocked: true, reason: validation.reason }
      }

      if (paper) {
        log.info({ params }, '[PAPER] order simulated')
        return {
          orderId: Date.now(),
          clientOrderId: `paper-${Date.now()}`,
          symbol: params.symbol,
          side: params.side,
          type: params.type,
          price: params.price ?? 0,
          origQty: params.quantity,
          status: 'PAPER_FILLED',
          transactTime: Date.now(),
        }
      }

      return adapter.placeOrder(params)
    }

    case 'cancel_order': {
      if (paper) {
        log.info({ orderId: input.orderId }, '[PAPER] cancel simulated')
        return { cancelled: true }
      }
      await adapter.cancelOrder(input.symbol as string, input.orderId as number)
      return { cancelled: true }
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ── Agent Cycle ───────────────────────────────────────────────────────────────

export async function runAgentCycle(config: AgentConfig): Promise<void> {
  const paper = isPaperMode(config)
  const maxIterations = config.maxIterations ?? 10

  log.info({ symbol: config.symbol, market: config.market, paper }, 'agent cycle start')

  if (isDailyLimitHitFor(config.market)) {
    log.warn({ market: config.market }, 'daily loss limit hit — skipping cycle')
    return
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Run a trading cycle for ${config.symbol} (${config.market}). Analyse the market and make your decision now.`,
    },
  ]

  const systemPrompt = buildSystemPrompt(config.market, paper)
  let iterations = 0

  while (iterations < maxIterations) {
    iterations++

    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL ?? 'claude-opus-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    })

    log.debug({ stop_reason: response.stop_reason, usage: response.usage }, 'claude response')

    // Append assistant turn to conversation
    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n')
      log.info({ decision: text }, 'cycle complete')
      const decMatch = text.match(/DECISION:\s*(.+)/i)
      const reasonMatch = text.match(/REASON:\s*(.+)/i)
      recordCycle({
        symbol: config.symbol,
        market: config.market,
        paper,
        decision: decMatch?.[1]?.trim() ?? 'UNKNOWN',
        reason: reasonMatch?.[1]?.trim() ?? '',
        time: new Date().toISOString(),
      })
      break
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue

        log.info({ tool: block.name, input: block.input }, 'tool call')

        let result: unknown
        try {
          result = await dispatchTool(
            block.name,
            block.input as Record<string, unknown>,
            config.market,
            paper,
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error({ tool: block.name, err: msg }, 'tool error')
          result = { error: msg }
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        })
      }

      messages.push({ role: 'user', content: toolResults })
      continue
    }

    // Unexpected stop reason (max_tokens, etc.)
    log.warn({ stop_reason: response.stop_reason }, 'unexpected stop reason — aborting cycle')
    break
  }

  if (iterations >= maxIterations) {
    log.warn({ maxIterations }, 'agent cycle hit iteration limit')
    recordCycle({
      symbol: config.symbol,
      market: config.market,
      paper,
      decision: 'ABORTED',
      reason: `Hit iteration limit (${maxIterations})`,
      time: new Date().toISOString(),
    })
  }
}
