// Wolf-Fin Tool Handlers — order execution
// Handles: place_order, cancel_order, close_position, modify_position

import pino from 'pino'
import { getAdapter } from '../../adapters/registry.js'
import { getMt5Context } from '../../guardrails/riskStateStore.js'
import { validateForMarket } from '../../guardrails/index.js'
import type { ValidateCtx } from '../../guardrails/index.js'
import { logEvent, getAgent } from '../../server/state.js'
import type { OrderParams } from '../../adapters/types.js'
import type { DispatchCtx } from './types.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

export async function handleExecution(name: string, ctx: DispatchCtx): Promise<unknown> {
  const { input, market, mt5AccountId, agentKey, suggestedLots } = ctx
  const adapter = getAdapter(market, mt5AccountId)

  switch (name) {
    case 'place_order': {
      let requestedQty = input.quantity as number

      // ── Lot-size guardrail: hard cap at suggested size ──────────────────────
      if (suggestedLots != null && suggestedLots > 0) {
        const maxAllowed = Math.max(0.01, suggestedLots)
        if (requestedQty > maxAllowed) {
          logEvent(agentKey, 'warn', 'guardrail_block',
            `Lot size clamped: agent requested ${requestedQty} lots but hard cap is ${maxAllowed} (suggested ${suggestedLots.toFixed(2)}). Using ${maxAllowed}.`)
          requestedQty = maxAllowed
        } else if (requestedQty < 0.01) {
          requestedQty = 0.01
        }
      }

      const params: OrderParams = {
        symbol:      input.symbol as string,
        side:        input.side as 'BUY' | 'SELL',
        type:        input.type as 'LIMIT' | 'MARKET',
        quantity:    requestedQty,
        price:       input.price as number | undefined,
        timeInForce: input.timeInForce as 'GTC' | 'IOC' | 'FOK' | undefined,
        stopPips:    input.stopPips as number | undefined,
        tpPips:      input.tpPips as number | undefined,
      }

      const agentGuardrails = getAgent(agentKey)?.config.guardrails
      const mt5Ctx = getMt5Context()
      const validCtx: ValidateCtx = market === 'mt5'
        ? { market: 'mt5', spread: mt5Ctx.spread, sessionOpen: mt5Ctx.sessionOpen, pipValue: mt5Ctx.pipValue, guardrails: agentGuardrails }
        : { market: 'crypto', price: params.price ?? 0 }

      const validation = validateForMarket(params, validCtx)
      if (!validation.ok) {
        log.warn({ reason: validation.reason }, 'order blocked by guardrails')
        return { blocked: true, reason: validation.reason }
      }

      // ── Convert pip distances to absolute prices for MT5 ────────────────────
      if (market === 'mt5' && params.price != null) {
        const pipSz = mt5Ctx.pipSize
        if (params.stopPips != null) {
          params.stopPrice = params.side === 'BUY'
            ? params.price - params.stopPips * pipSz
            : params.price + params.stopPips * pipSz
        }
        if (params.tpPips != null) {
          params.tpPrice = params.side === 'BUY'
            ? params.price + params.tpPips * pipSz
            : params.price - params.tpPips * pipSz
        }
      }

      return adapter.placeOrder(params)
    }

    case 'cancel_order': {
      await adapter.cancelOrder(input.symbol as string, input.orderId as number)
      return { cancelled: true }
    }

    case 'close_position': {
      const mt5 = adapter as import('../../adapters/mt5.js').MT5Adapter
      if (typeof mt5.closePosition !== 'function') throw new Error('close_position is only supported for MT5')
      return mt5.closePosition(input.ticket as number, input.volume as number | undefined)
    }

    case 'modify_position': {
      const mt5Adpt = adapter as import('../../adapters/mt5.js').MT5Adapter
      if (typeof mt5Adpt.modifyPosition !== 'function') throw new Error('modify_position is only supported for MT5')
      const { ticket, sl, tp } = input as { ticket: number; sl?: number; tp?: number }
      const result = await mt5Adpt.modifyPosition(ticket, sl, tp)
      logEvent(agentKey, 'info', 'auto_execute', `modify_position #${ticket} → SL:${sl ?? 'unchanged'} TP:${tp ?? 'unchanged'}`)
      return result
    }

    default:
      throw new Error(`Unknown execution tool: ${name}`)
  }
}
