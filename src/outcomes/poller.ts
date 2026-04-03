// Wolf-Fin — Outcome tracking poller
// Runs every POLL_INTERVAL_MS and checks whether pending/entered trade proposals
// have hit their entry zone, TP, or SL based on the live MT5 price.
//
// Status flow:  pending → entered → hit_tp1 | hit_tp2 | hit_sl | expired | invalidated

import pino from 'pino'
import { dbGetPendingOutcomes, dbUpdateOutcomeStatus, dbGetSymbol } from '../db/index.js'
import type { ProposalOutcome } from '../db/index.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

const POLL_INTERVAL_MS = 15 * 60 * 1000  // 15 minutes
const EXPIRY_HOURS     = 72               // mark as expired after 72h with no entry

// ── Price fetch ───────────────────────────────────────────────────────────────

async function fetchMidPrice(symbol: string, mt5AccountId?: number): Promise<number | null> {
  const base = process.env.MT5_BRIDGE_URL?.replace(/\/+$/, '') ??
    `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`
  const key  = process.env.MT5_BRIDGE_KEY ?? ''
  const hdrs: Record<string, string> = key ? { 'X-Bridge-Key': key } : {}

  try {
    const url = `${base}/price/${encodeURIComponent(symbol)}`
    const r   = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    const data = await r.json() as { bid?: number; ask?: number; mid?: number }
    if (data.mid != null) return data.mid
    if (data.bid != null && data.ask != null) return (data.bid + data.ask) / 2
    return null
  } catch {
    return null
  }
}

// ── Per-outcome check ─────────────────────────────────────────────────────────

async function checkOutcome(outcome: ProposalOutcome, price: number): Promise<void> {
  const now    = new Date().toISOString()
  const isBuy  = outcome.direction === 'BUY'

  if (outcome.status === 'pending') {
    // Check for entry: price enters the entry zone
    if (price >= outcome.entryLow && price <= outcome.entryHigh) {
      await dbUpdateOutcomeStatus(outcome.id, 'entered', { enteredAt: now })
      log.info({ id: outcome.id, symbol: outcome.symbolKey, price }, 'outcome entered')
      return
    }

    // Check for expiry
    const ageMs = Date.now() - new Date(outcome.createdAt).getTime()
    if (ageMs > EXPIRY_HOURS * 3600 * 1000) {
      await dbUpdateOutcomeStatus(outcome.id, 'expired', { resolvedAt: now })
      log.info({ id: outcome.id, symbol: outcome.symbolKey }, 'outcome expired without entry')
    }
    return
  }

  if (outcome.status === 'entered') {
    // Check SL hit
    const slHit = isBuy
      ? price <= outcome.sl
      : price >= outcome.sl

    // Check TP2 hit (best outcome)
    const tp2Hit = outcome.tp2 != null && (
      isBuy ? price >= outcome.tp2 : price <= outcome.tp2
    )

    // Check TP1 hit
    const tp1Hit = outcome.tp1 != null && (
      isBuy ? price >= outcome.tp1 : price <= outcome.tp1
    )

    const entryMid = (outcome.entryLow + outcome.entryHigh) / 2

    if (tp2Hit) {
      const pips = isBuy
        ? (price - entryMid) * 10000
        : (entryMid - price) * 10000
      await dbUpdateOutcomeStatus(outcome.id, 'hit_tp2', {
        resolvedAt: now, exitPrice: price, pipsResult: pips,
      })
      log.info({ id: outcome.id, symbol: outcome.symbolKey, price, pips }, 'outcome hit TP2')
    } else if (tp1Hit) {
      const pips = isBuy
        ? (price - entryMid) * 10000
        : (entryMid - price) * 10000
      await dbUpdateOutcomeStatus(outcome.id, 'hit_tp1', {
        resolvedAt: now, exitPrice: price, pipsResult: pips,
      })
      log.info({ id: outcome.id, symbol: outcome.symbolKey, price, pips }, 'outcome hit TP1')
    } else if (slHit) {
      const pips = isBuy
        ? (price - entryMid) * 10000
        : (entryMid - price) * 10000
      await dbUpdateOutcomeStatus(outcome.id, 'hit_sl', {
        resolvedAt: now, exitPrice: price, pipsResult: pips,
      })
      log.info({ id: outcome.id, symbol: outcome.symbolKey, price, pips }, 'outcome hit SL')
    }
  }
}

// ── Poll cycle ────────────────────────────────────────────────────────────────

async function pollOnce(): Promise<void> {
  const pending = dbGetPendingOutcomes()
  if (pending.length === 0) return

  // Group by symbol_key to avoid redundant price fetches
  const bySymbol = new Map<string, ProposalOutcome[]>()
  for (const o of pending) {
    const list = bySymbol.get(o.symbolKey) ?? []
    list.push(o)
    bySymbol.set(o.symbolKey, list)
  }

  for (const [symbolKey, outcomes] of bySymbol) {
    const sym = dbGetSymbol(symbolKey)
    if (!sym) continue

    const price = await fetchMidPrice(sym.symbol, sym.mt5AccountId)
    if (price == null) continue

    for (const outcome of outcomes) {
      await checkOutcome(outcome, price)
    }
  }
}

// ── Start / stop ──────────────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null

export function startOutcomePoller(): void {
  if (pollTimer) return
  // Run immediately on startup, then on interval
  pollOnce().catch(err => log.error({ err }, 'outcome poll error'))
  pollTimer = setInterval(() => {
    pollOnce().catch(err => log.error({ err }, 'outcome poll error'))
  }, POLL_INTERVAL_MS)
  log.info({ intervalMs: POLL_INTERVAL_MS }, 'outcome poller started')
}

export function stopOutcomePoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
