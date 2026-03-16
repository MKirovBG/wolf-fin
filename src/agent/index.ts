// Wolf-Fin Agent — core agentic trading loop

import type Anthropic from '@anthropic-ai/sdk'
import pino from 'pino'
import { getLLMProvider, getModelForConfig } from '../llm/index.js'
import { getAdapter } from '../adapters/registry.js'
import { getRiskState, isDailyLimitHit } from '../guardrails/riskState.js'
import { updatePositionNotionalFor, isDailyLimitHitFor, setForexContext, setMt5Context } from '../guardrails/riskStateStore.js'
import { validateOrder } from '../guardrails/validate.js'
import { validateForexOrder } from '../guardrails/forex.js'
import { validateMt5Order } from '../guardrails/mt5.js'
import { getForexContext, getMt5Context } from '../guardrails/riskStateStore.js'
import { buildMarketContext } from './context.js'
import { sessionLabel } from '../adapters/session.js'
import { TOOLS } from '../tools/definitions.js'
import { recordCycle, logEvent, tryAcquireCycleLock, releaseCycleLock } from '../server/state.js'
import { dbGetAgentPerformance } from '../db/index.js'
import type { AgentConfig } from '../types.js'
import type { OrderParams } from '../adapters/types.js'

export type { AgentConfig } from '../types.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

/** Pip size for stop-price calculation — commodity-aware */
function pipSize(symbol: string, point?: number): number {
  const s = symbol.toUpperCase()
  if (s.startsWith('XAU') || s.startsWith('XAG') || s.startsWith('XPT') || s.startsWith('XPD') ||
      s.includes('OIL') || s.includes('GAS') || s.includes('GOLD') || s.includes('SILVER')) {
    return point ?? 0.01
  }
  if (s.includes('JPY')) return 0.01
  return 0.0001
}

// ── System Prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(config: AgentConfig, agentKey: string): string {
  const { market, paper, customPrompt } = config
  const mode = paper ? '[PAPER TRADING — no real orders will be sent]' : '[LIVE TRADING]'
  const maxSpreadPips = parseFloat(process.env.MAX_SPREAD_PIPS ?? '3')
  const sessionNote =
    market === 'forex'
      ? `\nCURRENT SESSION: ${sessionLabel()}\nFOREX SESSION RULES: Only trade during Tokyo, London, or New York sessions. Avoid Sydney-only hours. Reject entries when spread > ${maxSpreadPips} pips or sessionOpen is false.\nNOTE: Overnight swap rates are unavailable from the data provider — do not factor swap costs into hold decisions.`
      : market === 'mt5'
        ? `\nCURRENT SESSION: ${sessionLabel()}\nMT5 SESSION RULES: Only trade during Tokyo, London, or New York sessions. Reject entries when spread > ${maxSpreadPips} pips or sessionOpen is false.\nMT5 provides real swap rates in the snapshot — factor overnight costs into hold decisions for multi-day positions.`
        : ''

  const base = `You are Wolf-Fin, an autonomous trading agent. ${mode}

ROLE: Disciplined, risk-first algorithmic trader. Make exactly one trading decision per cycle — HOLD, BUY, SELL, or CANCEL — based on technical evidence and market context.

PROCESS:
1. Call get_snapshot to get price, indicators, balances, open orders, and risk state.
2. Optionally call get_order_book to assess liquidity before sizing.
3. Reason through the evidence: trend (EMA cross), momentum (RSI), volatility (ATR, BB width), context signals.
4. Decide: HOLD / BUY qty @ price / SELL qty @ price / CANCEL orderId.
5. Execute via place_order or cancel_order. Always prefer LIMIT orders.
${market === 'forex' || market === 'mt5' ? `6. ${market === 'mt5' ? 'MT5' : 'Forex'}: always include stopPips on every order (ATR-based distance).` : ''}
RISK RULES (non-negotiable):
- If the daily loss limit is hit (remainingBudgetUsd = 0), HOLD unconditionally.
- Size so that a stop-out costs at most 1% of NAV.
- Do not pyramid an open position unless RSI and EMA both confirm.
- Never risk more than remainingBudgetUsd on a single trade.
${sessionNote}`

  const perf = dbGetAgentPerformance(agentKey, 10)
  const perfSection = perf.totalCycles > 0
    ? `\n\nYOUR RECENT PERFORMANCE (last ${perf.totalCycles} cycles on ${config.symbol}):
- Decisions: BUY ${perf.buys} | SELL ${perf.sells} | HOLD ${perf.holds}
- Last decisions: ${perf.lastDecisions.map(d => `[${d.time.slice(11, 16)}] ${d.decision.split(' ')[0]}`).join(' → ')}${perf.holds >= 5 && perf.buys === 0 && perf.sells === 0 ? '\nWARNING: You have held every recent cycle. Re-examine if conditions truly warrant inaction or if you are being overly cautious.' : ''}`
    : ''

  const decisionFormat = `\n\nEXECUTION RULES (mandatory — the DECISION line does NOT trigger a trade by itself):
- If BUY or SELL: you MUST call place_order FIRST, then write the DECISION line.
- If CANCEL: you MUST call cancel_order FIRST, then write the DECISION line.
- If HOLD: do NOT call place_order. Just write the DECISION line.
- Always include stopPips on place_order (use ATR14 × 1.5 as minimum distance).

DECISION FORMAT (write AFTER executing the tool call):
DECISION: [HOLD | BUY <qty> @ <price> | SELL <qty> @ <price> | CANCEL <orderId>]
REASON: <1-2 sentences of evidence>`

  const full = base + perfSection + decisionFormat
  return customPrompt ? `${full}\n\nADDITIONAL INSTRUCTIONS:\n${customPrompt}` : full
}

// ── Cycle user message with signal priority ────────────────────────────────────

function buildCycleUserMessage(config: AgentConfig): string {
  return `Run a trading cycle for ${config.symbol} (${config.market}).

SIGNAL PRIORITY (evaluate in order):
1. RISK GATE — if remainingBudgetUsd = 0, output HOLD immediately without further tool calls
2. TREND — EMA20 vs EMA50 direction (EMA20 > EMA50 = bullish bias)
3. MOMENTUM — RSI14: <30 oversold watch, >70 overbought watch, 45-55 neutral
4. VOLATILITY — ATR14 and BB width for stop sizing and breakout detection
5. CONTEXT — Fear/Greed (crypto) or session quality (forex); skip if high-impact event imminent
6. POSITION — manage any existing open position before entering a new one

Use at most 3 tool calls per cycle. Call get_snapshot first. Only call get_order_book if actively sizing a new entry.`
}

// ── Tool result summariser (keeps logs readable) ──────────────────────────────

function summariseToolResult(name: string, result: unknown): string {
  try {
    if (name === 'get_snapshot') {
      const s = result as { price?: { last?: number }; indicators?: { rsi14?: number; ema20?: number }; stats24h?: { changePercent?: number } }
      return `price=${s.price?.last?.toFixed(4)} rsi=${s.indicators?.rsi14?.toFixed(1)} ema20=${s.indicators?.ema20?.toFixed(4)} 24hChg=${s.stats24h?.changePercent?.toFixed(2)}%`
    }
    if (name === 'get_order_book') {
      const b = result as { bids?: [number, number][]; asks?: [number, number][] }
      return `best bid=${b.bids?.[0]?.[0]} ask=${b.asks?.[0]?.[0]}`
    }
    if (name === 'place_order') {
      const o = result as { status?: string; orderId?: number; blocked?: boolean; reason?: string }
      if (o.blocked) return `BLOCKED — ${o.reason}`
      return `status=${o.status} orderId=${o.orderId}`
    }
    if (name === 'cancel_order') return 'cancelled'
    return JSON.stringify(result).slice(0, 120)
  } catch { return '(unparseable)' }
}

// ── Tool Dispatcher ───────────────────────────────────────────────────────────

async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  defaultMarket: 'crypto' | 'forex' | 'mt5',
  paper: boolean,
  mt5AccountId?: number,
): Promise<unknown> {
  const market = (input.market as 'crypto' | 'forex' | 'mt5' | undefined) ?? defaultMarket
  const adapter = getAdapter(market, mt5AccountId)

  switch (name) {
    case 'get_snapshot': {
      const riskState = getRiskState()
      const snap = await adapter.getSnapshot(input.symbol as string, riskState)
      snap.context = await buildMarketContext(input.symbol as string, market)
      const openNotional = snap.account.openOrders.reduce(
        (sum, o) => sum + o.price * o.origQty, 0,
      )
      updatePositionNotionalFor(market, openNotional)
      if (market === 'forex' && snap.forex) {
        setForexContext({ spread: snap.forex.spread, sessionOpen: snap.forex.sessionOpen, pipValue: snap.forex.pipValue })
      }
      if (market === 'mt5' && snap.forex) {
        const pt = snap.forex.point ?? 0.0001
        setMt5Context({ spread: snap.forex.spread, sessionOpen: snap.forex.sessionOpen, pipValue: snap.forex.pipValue, point: pt, digits: pt <= 0.001 ? 5 : 2 })
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
          ? (() => { const fx = getForexContext(); return validateForexOrder(params, fx.spread, fx.sessionOpen, fx.pipValue) })()
          : market === 'mt5'
            ? (() => { const ctx = getMt5Context(); return validateMt5Order(params, ctx.spread, ctx.sessionOpen, ctx.pipValue) })()
            : validateOrder(params, params.price ?? 0)
      if (!validation.ok) {
        log.warn({ reason: validation.reason }, 'order blocked by guardrails')
        return { blocked: true, reason: validation.reason }
      }
      // Compute absolute stop price for forex / MT5 bracket orders
      if ((market === 'forex' || market === 'mt5') && params.stopPips != null && params.price != null) {
        const ctxPoint = market === 'mt5' ? getMt5Context().point : undefined
        const pipSz = pipSize(params.symbol, ctxPoint)
        params.stopPrice = params.side === 'BUY'
          ? params.price - params.stopPips * pipSz
          : params.price + params.stopPips * pipSz
      }
      if (paper) {
        log.info({ params }, '[PAPER] order simulated')
        return { orderId: Date.now(), clientOrderId: `paper-${Date.now()}`, symbol: params.symbol, side: params.side, type: params.type, price: params.price ?? 0, origQty: params.quantity, status: 'PAPER_FILLED', transactTime: Date.now() }
      }
      return adapter.placeOrder(params)
    }
    case 'cancel_order': {
      if (paper) { log.info({ orderId: input.orderId }, '[PAPER] cancel simulated'); return { cancelled: true } }
      await adapter.cancelOrder(input.symbol as string, input.orderId as number)
      return { cancelled: true }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ── Agent Cycle ───────────────────────────────────────────────────────────────

export async function runAgentCycle(config: AgentConfig): Promise<void> {
  const paper = config.paper
  const maxIterations = config.maxIterations
  const agentKey = `${config.market}:${config.symbol}`

  if (!tryAcquireCycleLock(agentKey)) {
    logEvent(agentKey, 'warn', 'cycle_skip', 'Cycle already running — skipped duplicate trigger')
    log.warn({ agentKey }, 'cycle already in flight — skipping tick')
    return
  }

  try {
  logEvent(agentKey, 'info', 'cycle_start', `Starting cycle for ${config.symbol} (${config.market}) [${paper ? 'PAPER' : 'LIVE'}]`)
  log.info({ symbol: config.symbol, market: config.market, paper }, 'agent cycle start')

  if (isDailyLimitHitFor(config.market)) {
    logEvent(agentKey, 'warn', 'session_skip', 'Daily loss limit hit — skipping cycle')
    log.warn({ market: config.market }, 'daily loss limit hit — skipping cycle')
    return
  }

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildCycleUserMessage(config) },
  ]

  const systemPrompt = buildSystemPrompt(config, agentKey)
  const llmProvider = getLLMProvider(config)
  const llmModel = getModelForConfig(config)
  let iterations = 0
  let orderPlacedThisCycle = false

  try {
    while (iterations < maxIterations) {
      iterations++
      const providerLabel = config.llmProvider === 'openrouter' ? `OpenRouter/${llmModel}` : `Anthropic/${llmModel}`
      logEvent(agentKey, 'debug', 'claude_thinking', `Sending to ${providerLabel} (iteration ${iterations}/${maxIterations})`)

      const response = await llmProvider.createMessage({
        model: llmModel,
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      })

      log.debug({ stop_reason: response.stop_reason, usage: response.usage }, 'claude response')
      messages.push({ role: 'assistant', content: response.content })

      if (response.stop_reason === 'end_turn') {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n')

        // Log Claude's full reasoning
        if (text.trim()) {
          logEvent(agentKey, 'info', 'claude_thinking', text.trim())
        }

        const decMatch   = text.match(/DECISION:\s*(.+)/i)
        const reasonMatch = text.match(/REASON:\s*(.+)/i)
        const decision   = decMatch?.[1]?.trim() ?? 'UNKNOWN'
        const reason     = reasonMatch?.[1]?.trim() ?? ''

        logEvent(agentKey, 'info', 'decision', `DECISION: ${decision}${reason ? ` — ${reason}` : ''}`)
        log.info({ decision }, 'cycle complete')

        // Auto-execute safety net: if agent stated BUY/SELL/CANCEL but never called the tool, execute now
        if (!orderPlacedThisCycle) {
          const buyMatch  = decision.match(/^BUY\s+([\d.]+)\s+@\s+([\d.]+)/i)
          const sellMatch = decision.match(/^SELL\s+([\d.]+)\s+@\s+([\d.]+)/i)
          const cancelMatch = decision.match(/^CANCEL\s+(\d+)/i)

          if (buyMatch || sellMatch) {
            const match = (buyMatch ?? sellMatch)!
            const side  = buyMatch ? 'BUY' : 'SELL'
            const qty   = parseFloat(match[1])
            const price = parseFloat(match[2])
            const ctx   = config.market === 'mt5' ? getMt5Context() : getForexContext()
            // ATR-based fallback stop: use MIN_STOP_PIPS * 2 or 20 pips minimum
            const fallbackStop = Math.max(parseFloat(process.env.MIN_STOP_PIPS ?? '10') * 2, 20)
            logEvent(agentKey, 'warn', 'auto_execute', `Agent stated ${side} without calling place_order — auto-executing via text decision`)
            try {
              const result = await dispatchTool('place_order', {
                symbol: config.symbol, market: config.market,
                side, type: 'LIMIT', quantity: qty, price, stopPips: fallbackStop,
              }, config.market, paper, config.mt5AccountId)
              logEvent(agentKey, 'info', 'tool_result', `← auto place_order: ${summariseToolResult('place_order', result)}`)
            } catch (autoErr) {
              const msg = autoErr instanceof Error ? autoErr.message : String(autoErr)
              logEvent(agentKey, 'error', 'auto_execute_error', `Auto-execute failed: ${msg}`)
            }
          } else if (cancelMatch) {
            const orderId = parseInt(cancelMatch[1], 10)
            logEvent(agentKey, 'warn', 'auto_execute', `Agent stated CANCEL without calling cancel_order — auto-executing`)
            try {
              await dispatchTool('cancel_order', { symbol: config.symbol, market: config.market, orderId }, config.market, paper, config.mt5AccountId)
              logEvent(agentKey, 'info', 'tool_result', '← auto cancel_order: cancelled')
            } catch (autoErr) {
              const msg = autoErr instanceof Error ? autoErr.message : String(autoErr)
              logEvent(agentKey, 'error', 'auto_execute_error', `Auto-cancel failed: ${msg}`)
            }
          }
        }

        recordCycle(agentKey, { symbol: config.symbol, market: config.market, paper, decision, reason, time: new Date().toISOString(), mt5AccountId: config.mt5AccountId })
        break
      }

      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = []

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue

          const inputSummary = Object.entries(block.input as Record<string, unknown>)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(' ')

          logEvent(agentKey, 'info', 'tool_call', `→ ${block.name}(${inputSummary})`)
          log.info({ tool: block.name, input: block.input }, 'tool call')

          if (block.name === 'place_order' || block.name === 'cancel_order') orderPlacedThisCycle = true

          let result: unknown
          try {
            result = await dispatchTool(block.name, block.input as Record<string, unknown>, config.market, paper, config.mt5AccountId)
            const summary = summariseToolResult(block.name, result)
            logEvent(agentKey, 'info', 'tool_result', `← ${block.name}: ${summary}`)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            logEvent(agentKey, 'error', 'tool_error', `← ${block.name} ERROR: ${msg}`)
            log.error({ tool: block.name, err: msg }, 'tool error')
            result = { error: msg }
          }

          // Strip raw candles from snapshot before adding to message history —
          // indicators are already derived from them, so candles just waste tokens.
          const resultForHistory = block.name === 'get_snapshot' && result != null
            ? { ...(result as Record<string, unknown>), candles: undefined }
            : result
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultForHistory) })
        }

        messages.push({ role: 'user', content: toolResults })
        continue
      }

      logEvent(agentKey, 'warn', 'cycle_end', `Unexpected stop reason: ${response.stop_reason}`)
      log.warn({ stop_reason: response.stop_reason }, 'unexpected stop reason — aborting cycle')
      break
    }

    if (iterations >= maxIterations) {
      logEvent(agentKey, 'warn', 'cycle_end', `Hit iteration limit (${maxIterations}) — cycle aborted`)
      log.warn({ maxIterations }, 'agent cycle hit iteration limit')
      recordCycle(agentKey, { symbol: config.symbol, market: config.market, paper, decision: 'ABORTED', reason: `Hit iteration limit (${maxIterations})`, time: new Date().toISOString() })
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logEvent(agentKey, 'error', 'cycle_error', `Cycle failed: ${msg}`)
    log.error({ err: msg }, 'agent cycle crashed')
    recordCycle(agentKey, { symbol: config.symbol, market: config.market, paper, decision: 'ERROR', reason: msg, time: new Date().toISOString(), error: msg })
  }

  logEvent(agentKey, 'info', 'cycle_end', `Cycle complete after ${iterations} iteration(s)`)
  } finally {
    releaseCycleLock(agentKey)
  }
}
