// Wolf-Fin Tool Handlers — memory, planning, trade history
// Handles: save_memory, read_memories, delete_memory, save_plan, get_plan, get_trade_history

import { getAdapter } from '../../adapters/registry.js'
import {
  dbSaveMemory, dbGetMemories, dbDeleteMemory,
  dbSavePlan, dbGetActivePlan,
} from '../../db/index.js'
import { logEvent, getAgent } from '../../server/state.js'
import type { DispatchCtx } from './types.js'

export async function handleIntelligence(name: string, ctx: DispatchCtx): Promise<unknown> {
  const { input, market, mt5AccountId, agentKey } = ctx

  switch (name) {
    case 'save_memory': {
      const { category, key, value, confidence, ttl_hours } = input as {
        category: string; key: string; value: string; confidence: number; ttl_hours?: number
      }
      dbSaveMemory(agentKey, category, key, value, confidence, ttl_hours)
      logEvent(agentKey, 'info', 'memory_write', `Saved memory [${category}] "${key}" (conf ${confidence})`)
      return { ok: true, message: `Memory saved: [${category}] ${key}` }
    }

    case 'read_memories': {
      const { category, limit } = input as { category?: string; limit?: number }
      const memories = dbGetMemories(agentKey, category, limit ?? 10)
      return { memories, count: memories.length }
    }

    case 'delete_memory': {
      const { category, key } = input as { category: string; key: string }
      dbDeleteMemory(agentKey, category, key)
      logEvent(agentKey, 'info', 'memory_write', `Deleted memory [${category}] "${key}"`)
      return { ok: true }
    }

    case 'save_plan': {
      const { market_bias, key_levels, risk_notes, plan_text, session_label } = input as {
        market_bias: string; key_levels?: string; risk_notes?: string; plan_text: string; session_label?: string
      }
      const planId = dbSavePlan(agentKey, {
        marketBias:    market_bias,
        keyLevels:     key_levels,
        riskNotes:     risk_notes,
        planText:      plan_text,
        sessionLabel:  session_label,
        cycleCountAt:  getAgent(agentKey)?.cycleCount,
      })
      logEvent(agentKey, 'info', 'plan_created', `Session plan saved [${market_bias.toUpperCase()}] id=${planId}`)
      return { ok: true, planId, message: `Session plan saved with bias: ${market_bias}` }
    }

    case 'get_plan': {
      const plan = dbGetActivePlan(agentKey)
      if (!plan) return { plan: null, message: 'No active plan for today. Consider running a planning cycle.' }
      return { plan }
    }

    case 'get_trade_history': {
      if (market !== 'mt5') return { error: 'get_trade_history is only available for MT5' }
      const mt5Adpt = getAdapter(market, mt5AccountId) as import('../../adapters/mt5.js').MT5Adapter
      const days  = (input.days  as number | undefined) ?? 1
      const limit = (input.limit as number | undefined) ?? 20
      const sym   = input.symbol as string | undefined
      const deals = await mt5Adpt.getDeals(sym, days, limit)
      const DEAL_TYPE: Record<number, string> = {
        0: 'BUY', 1: 'SELL', 2: 'BALANCE', 3: 'CREDIT',
        4: 'CHARGE', 5: 'CORRECTION', 6: 'BONUS',
      }
      return deals.map((d: {
        ticket: number; symbol: string; type: number; volume: number; price: number
        profit: number; commission: number; swap: number; comment: string; time: string
      }) => ({
        ticket:     d.ticket,
        symbol:     d.symbol,
        type:       DEAL_TYPE[d.type] ?? `TYPE_${d.type}`,
        volume:     d.volume,
        price:      d.price,
        profit:     d.profit,
        commission: d.commission,
        swap:       d.swap,
        comment:    d.comment,
        time:       d.time,
      }))
    }

    default:
      throw new Error(`Unknown intelligence tool: ${name}`)
  }
}
