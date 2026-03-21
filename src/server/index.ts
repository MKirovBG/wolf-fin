// Wolf-Fin — HTTP dashboard server

import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'fs'
import pino from 'pino'
import { getState, getAgent, upsertAgent, removeAgent, setAgentStatus, getLogs, subscribeToLogs, subscribeToAgentStatus } from './state.js'
import { dbGetCycleResults, dbGetCycleResultsForAgent, dbGetCycleById, dbGetLogsForCycle, dbGetMaxLogId, dbGetLogClearFloor, dbSetLogClearFloor, makeAgentKey, dbGetStrategy, dbSaveStrategy, dbDeleteStrategy, dbGetMemories, dbClearMemories, dbDeleteMemory, dbGetActivePlan, dbGetAllPlans, dbResetAgentData, dbGetSelectedAccount, dbSetSelectedAccount } from '../db/index.js'
import type { SelectedAccount } from '../db/index.js'
import { getRiskState } from '../guardrails/riskState.js'
import { getRiskStateFor } from '../guardrails/riskStateStore.js'
import { startAgentSchedule, pauseAgentSchedule, stopAgentSchedule } from '../scheduler/index.js'
import { runAgentTick } from '../agent/index.js'
import { getAdapter } from '../adapters/registry.js'
import { binanceAdapter } from '../adapters/binance.js'
import type { AgentConfig, AgentState } from '../types.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })
const PORT = parseInt(process.env.PORT ?? '3000', 10)
const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Helpers ────────────────────────────────────────────────────────────────────

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'CLAUDE_MODEL',
  'OPENROUTER_API_KEY',
  'BINANCE_API_KEY', 'BINANCE_API_SECRET',
  'FINNHUB_KEY', 'TWELVE_DATA_KEY', 'COINGECKO_KEY',
  'OLLAMA_URL',
] as const

function envPresent(key: string): boolean {
  return !!process.env[key]?.trim()
}

function persistEnvKey(key: string, value: string): void {
  const envPath = join(__dirname, '../../.env')
  if (!existsSync(envPath)) return
  const content = readFileSync(envPath, 'utf8')
  const regex = new RegExp(`^${key}=.*$`, 'm')
  if (regex.test(content)) {
    writeFileSync(envPath, content.replace(regex, `${key}=${value}`))
  } else {
    appendFileSync(envPath, `\n${key}=${value}`)
  }
  process.env[key] = value
}

async function testConnection(service: string): Promise<{ ok: boolean; message: string }> {
  try {
    switch (service) {
      case 'anthropic': {
        const r = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
        })
        return r.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `HTTP ${r.status}` }
      }
      case 'openrouter': {
        const key = process.env.OPENROUTER_API_KEY
        if (!key) return { ok: false, message: 'OPENROUTER_API_KEY not set' }
        const r = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { 'Authorization': `Bearer ${key}` },
        })
        if (!r.ok) return { ok: false, message: `HTTP ${r.status}` }
        const data = await r.json() as { data: unknown[] }
        return { ok: true, message: `Connected — ${data.data.length} models available` }
      }
      case 'binance': {
        const binKey    = process.env.BINANCE_API_KEY?.trim()
        const binSecret = process.env.BINANCE_API_SECRET?.trim()
        if (binKey && binSecret) {
          const { createHmac } = await import('crypto')
          const testnet = process.env.BINANCE_TESTNET === 'true'
          const base = testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com'
          const ts = Date.now()
          const qs = `timestamp=${ts}`
          const sig = createHmac('sha256', binSecret).update(qs).digest('hex')
          const r = await fetch(`${base}/api/v3/account?${qs}&signature=${sig}`, {
            headers: { 'X-MBX-APIKEY': binKey },
          })
          if (r.ok) {
            const data = await r.json() as { balances?: Array<{ free: string; locked: string }> }
            const nonZero = (data.balances ?? []).filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0).length
            return { ok: true, message: `Account OK — ${nonZero} non-zero balance${nonZero !== 1 ? 's' : ''}` }
          }
          const errText = await r.text()
          return { ok: false, message: `HTTP ${r.status}: ${errText}` }
        }
        const base = 'https://api.binance.com'
        const r = await fetch(`${base}/api/v3/ping`)
        return r.ok ? { ok: true, message: 'Ping OK (no keys set — auth not verified)' } : { ok: false, message: `HTTP ${r.status}` }
      }
      case 'ollama': {
        const baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
        const r = await fetch(`${baseUrl}/api/tags`)
        if (!r.ok) return { ok: false, message: `HTTP ${r.status}` }
        const data = await r.json() as { models: unknown[] }
        return { ok: true, message: `Connected — ${data.models.length} local model${data.models.length !== 1 ? 's' : ''}` }
      }
      case 'finnhub': {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${process.env.FINNHUB_KEY ?? ''}`)
        return r.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `HTTP ${r.status}` }
      }
      case 'twelvedata': {
        const r = await fetch(`https://api.twelvedata.com/price?symbol=AAPL&apikey=${process.env.TWELVE_DATA_KEY ?? ''}`)
        return r.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `HTTP ${r.status}` }
      }
      case 'coingecko': {
        const cgKey = process.env.COINGECKO_KEY?.trim()
        const isDemo = cgKey?.startsWith('CG-')
        const base = (cgKey && !isDemo) ? 'https://pro-api.coingecko.com' : 'https://api.coingecko.com'
        const headers: Record<string, string> = {}
        if (cgKey && isDemo)  headers['x-cg-demo-api-key'] = cgKey
        if (cgKey && !isDemo) headers['x-cg-pro-api-key']  = cgKey
        const r = await fetch(`${base}/api/v3/simple/price?ids=bitcoin&vs_currencies=usd`, { headers })
        if (!r.ok) return { ok: false, message: `HTTP ${r.status}` }
        const data = await r.json() as { bitcoin?: { usd?: number } }
        const price = data?.bitcoin?.usd
        const tier = !cgKey ? 'free tier' : isDemo ? 'demo key' : 'pro key'
        return price
          ? { ok: true, message: `Connected (${tier}) — BTC $${price.toLocaleString()}` }
          : { ok: false, message: 'Connected but response malformed' }
      }
      default:
        return { ok: false, message: 'Unknown service' }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : (typeof e === 'object' && e !== null && 'message' in e ? String((e as Record<string, unknown>).message) : String(e))
    return { ok: false, message: msg }
  }
}

function defaultAgentState(config: AgentConfig): AgentState {
  return { config, status: 'idle', lastCycle: null, startedAt: null, cycleCount: 0 }
}

// ── Server ─────────────────────────────────────────────────────────────────────

export async function startServer(): Promise<void> {
  const app = Fastify({ logger: false })

  // ── Status ──────────────────────────────────────────────────────────────────
  app.get('/api/status', async () => {
    const { agents, recentEvents } = getState()
    return {
      agents: Object.entries(agents).map(([key, agent]) => ({ ...agent, agentKey: key })),
      recentEvents,
      risk: getRiskState(),
    }
  })

  // ── Selected account ────────────────────────────────────────────────────────

  app.get('/api/selected-account', async () => {
    return dbGetSelectedAccount() ?? null
  })

  app.post('/api/selected-account', async (req) => {
    const body = req.body as SelectedAccount | null
    dbSetSelectedAccount(body)
    return { ok: true }
  })

  // ── Agents ──────────────────────────────────────────────────────────────────

  app.get('/api/agents', async (req) => {
    const { market, accountId } = req.query as { market?: string; accountId?: string }
    let entries = Object.entries(getState().agents)
    // Filter by market when specified
    if (market) entries = entries.filter(([, a]) => a.config.market === market)
    // Filter by accountId (MT5 login or 'binance')
    if (accountId !== undefined) {
      if (market === 'mt5' || (!market && accountId !== 'binance')) {
        entries = entries.filter(([, a]) => String(a.config.mt5AccountId ?? '') === accountId)
      }
      // crypto/binance: accountId='binance' — market filter above is sufficient
    }
    // Include agentKey in every response so frontend never has to reconstruct it
    return entries.map(([key, agent]) => ({ ...agent, agentKey: key }))
  })

  app.post('/api/agents', async (req) => {
    const body = req.body as AgentConfig
    const key = makeAgentKey(body.market, body.symbol, body.mt5AccountId, body.name)

    // Detect agents sharing the same market+symbol+broker but different name
    const conflicts = Object.entries(getState().agents)
      .filter(([existingKey, a]) =>
        existingKey !== key &&
        a.config.market === body.market &&
        a.config.symbol === body.symbol &&
        (a.config.mt5AccountId ?? null) === (body.mt5AccountId ?? null),
      )
      .map(([, a]) => a.config.name ?? 'unnamed')

    upsertAgent(defaultAgentState(body))
    return { ok: true, key, conflicts: conflicts.length > 0 ? conflicts : undefined }
  })

  app.delete('/api/agents/:key', async (req) => {
    const { key } = req.params as { key: string }
    const decoded = decodeURIComponent(key)
    stopAgentSchedule(decoded)
    removeAgent(decoded)
    // Cascade delete all agent data from DB
    const { dbResetAgentData } = await import('../db/index.js')
    dbResetAgentData(decoded)
    return { ok: true }
  })

  app.patch('/api/agents/:key/config', async (req) => {
    const { key } = req.params as { key: string }
    const patch = req.body as Partial<AgentConfig>
    const agent = getAgent(key)
    if (!agent) return { ok: false, message: 'Agent not found' }

    const wasRunning = agent.status === 'running'
    if (wasRunning) stopAgentSchedule(key)

    const updated: AgentState = { ...agent, config: { ...agent.config, ...patch } }
    upsertAgent(updated)

    if (wasRunning) startAgentSchedule(updated.config)
    return { ok: true }
  })

  app.post('/api/agents/:key/start', async (req) => {
    const { key } = req.params as { key: string }
    const agent = getAgent(key)
    if (!agent) return { ok: false, message: 'Agent not found' }
    startAgentSchedule(agent.config)
    return { ok: true }
  })

  app.post('/api/agents/:key/pause', async (req) => {
    const { key } = req.params as { key: string }
    if (!getAgent(key)) return { ok: false, message: 'Agent not found' }
    pauseAgentSchedule(key)
    return { ok: true }
  })

  app.post('/api/agents/:key/stop', async (req) => {
    const { key } = req.params as { key: string }
    if (!getAgent(key)) return { ok: false, message: 'Agent not found' }
    stopAgentSchedule(key)
    return { ok: true }
  })

  app.post('/api/agents/:key/trigger', async (req) => {
    const { key } = req.params as { key: string }
    const agent = getAgent(key)
    if (!agent) return { ok: false, message: 'Agent not found' }
    runAgentTick(agent.config).catch(err => log.error({ err, key }, 'manual trigger error'))
    return { ok: true }
  })

  app.get('/api/agents/:key/cycles', async (req, reply) => {
    const key = decodeURIComponent((req.params as { key: string }).key)
    const { limit } = req.query as { limit?: string }
    if (!getAgent(key)) return reply.status(404).send({ error: 'Agent not found' })
    return dbGetCycleResultsForAgent(key, limit ? parseInt(limit) : 100)
  })

  // ── System Prompt ────────────────────────────────────────────────────────────
  app.get('/api/system-prompt/:key', async (req, reply) => {
    const { key } = req.params as { key: string }
    const agent = getAgent(key)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })
    const { buildSystemPrompt } = await import('../agent/index.js')
    const prompt = buildSystemPrompt(agent.config, key)
    return reply.send({ prompt })
  })

  // ── Logs ────────────────────────────────────────────────────────────────────
  app.get('/api/logs', async (req) => {
    const { since, agent } = req.query as { since?: string; agent?: string }
    const floor = dbGetLogClearFloor()
    const effectiveSince = Math.max(since ? parseInt(since) : 0, floor)
    return getLogs(effectiveSince || undefined, agent)
  })

  app.post('/api/logs/clear', async () => {
    const maxId = dbGetMaxLogId()
    dbSetLogClearFloor(maxId)
    return { ok: true, clearedAt: maxId }
  })

  // ── SSE log stream — real-time push, replaces polling ────────────────────────
  app.get('/api/events', async (req, reply) => {
    const { agent, since } = req.query as { agent?: string; since?: string }
    const floor = dbGetLogClearFloor()
    const sinceId = Math.max(since ? parseInt(since) : 0, floor)

    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.raw.flushHeaders()

    // Send any missed events since the client's last known ID
    if (sinceId > 0) {
      const missed = getLogs(sinceId, agent, 100)
      for (const entry of [...missed].reverse()) {
        reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`)
      }
    }

    // Subscribe to log events
    const unsubscribeLogs = subscribeToLogs((entry) => {
      if (agent && entry.agentKey !== agent) return
      if (entry.id <= floor) return
      try {
        reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`)
      } catch { /* client disconnected */ }
    })

    // Subscribe to agent status/cycle changes — send as named 'agent' event
    const unsubscribeStatus = subscribeToAgentStatus((event) => {
      if (agent && event.agentKey !== agent) return
      try {
        reply.raw.write(`event: agent\ndata: ${JSON.stringify({ ...event.agent, agentKey: event.agentKey })}\n\n`)
      } catch { /* client disconnected */ }
    })

    // Heartbeat every 20s to keep connection alive through proxies
    const heartbeat = setInterval(() => {
      try { reply.raw.write(': heartbeat\n\n') } catch { clearInterval(heartbeat); unsubscribeLogs(); unsubscribeStatus() }
    }, 20_000)

    req.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribeLogs()
      unsubscribeStatus()
    })

    // Keep the handler open — reply.raw handles the stream
    await new Promise<void>(resolve => req.raw.on('close', resolve))
  })

  // ── Market Data (read-only snapshot, no agent/Claude involved) ───────────────
  app.get('/api/market/:market/:symbol', async (req, reply) => {
    const { market, symbol } = req.params as { market: string; symbol: string }
    if (market !== 'crypto' && market !== 'mt5') {
      return reply.status(400).send({ error: 'market must be crypto or mt5' })
    }
    try {
      const adapter = getAdapter(market as 'crypto' | 'mt5')
      const snapshot = await adapter.getSnapshot(symbol, getRiskState())
      return snapshot
    } catch (e) {
      log.error({ market, symbol, err: e }, 'market data fetch error')
      return reply.status(502).send({ error: e instanceof Error ? e.message : 'Fetch failed' })
    }
  })

  // ── Keys ────────────────────────────────────────────────────────────────────
  app.get('/api/keys', async () => {
    return Object.fromEntries(ENV_KEYS.map(k => [k, envPresent(k)]))
  })

  app.post('/api/keys', async (req) => {
    const { key, value } = req.body as { key: string; value: string }
    if (!ENV_KEYS.includes(key as (typeof ENV_KEYS)[number])) {
      return { ok: false, message: 'Unknown key' }
    }
    persistEnvKey(key, value)
    return { ok: true }
  })

  app.post('/api/keys/test/:service', async (req) => {
    const { service } = req.params as { service: string }
    return testConnection(service)
  })

  // ── Reports ─────────────────────────────────────────────────────────────────
  app.get('/api/reports/summary', async () => {
    const summary = (market: 'crypto' | 'mt5') => {
      const events = dbGetCycleResults(market)
      return {
        totalCycles: events.length,
        buys: events.filter(e => e.decision.toUpperCase().startsWith('BUY')).length,
        sells: events.filter(e => e.decision.toUpperCase().startsWith('SELL')).length,
        holds: events.filter(e => e.decision.toUpperCase().startsWith('HOLD')).length,
        errors: events.filter(e => e.error).length,
        risk: getRiskStateFor(market),
      }
    }
    return { crypto: summary('crypto'), mt5: summary('mt5') }
  })

  app.get('/api/reports/trades', async (req) => {
    const { market } = req.query as { market?: string }
    return dbGetCycleResults(market as 'crypto' | 'mt5' | undefined)
  })

  // ── Cycle detail — full context for a single cycle ───────────────────────────
  app.get('/api/cycles/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const cycle = dbGetCycleById(parseInt(id, 10))
    if (!cycle) return reply.status(404).send({ error: 'Cycle not found' })

    // Fetch the agent config for context
    const agentState = getAgent(cycle.agentKey)

    // Fetch all log entries that occurred during this cycle's execution window
    const logs = dbGetLogsForCycle(cycle.agentKey, cycle.time)

    return reply.send({ cycle, agent: agentState ?? null, logs })
  })

  // ── Accounts ─────────────────────────────────────────────────────────────────

  type BinanceAccountEntry = {
    id: string; exchange: 'binance'; mode: 'LIVE' | 'TESTNET'
    connected: boolean; error?: string
    balances?: Array<{ asset: string; free: number; locked: number }>
    openOrders?: Array<{ symbol: string; side: string; type: string; price: number; origQty: number; executedQty: number; status: string; time: number }>
  }

  type Mt5AccountEntry = {
    id: string; exchange: 'mt5'; mode: 'DEMO' | 'LIVE'
    connected: boolean; error?: string
    summary?: { balance: number; equity: number; margin: number; freeMargin: number; profit: number; leverage: number; login: number; server: string }
    positions?: Array<{ ticket: number; symbol: string; side: 'BUY' | 'SELL'; volume: number; priceOpen: number; priceCurrent: number; profit: number; swap: number; sl: number; tp: number; time: string }>
  }

  type AccountEntry = BinanceAccountEntry | Mt5AccountEntry

  async function fetchBinanceEntry(): Promise<BinanceAccountEntry> {
    const { createHmac } = await import('crypto')
    const binKey    = process.env.BINANCE_API_KEY?.trim() ?? ''
    const binSecret = process.env.BINANCE_API_SECRET?.trim() ?? ''
    if (!binKey) throw new Error('Keys not configured')
    const testnet = process.env.BINANCE_TESTNET === 'true'
    const mode = testnet ? 'TESTNET' : 'LIVE'
    const base = testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com'
    const ts = Date.now()
    const qs = `timestamp=${ts}`
    const sig = createHmac('sha256', binSecret).update(qs).digest('hex')
    type BinanceAcct = { balances: Array<{ asset: string; free: string; locked: string }> }
    type BinanceOrder = { symbol: string; side: string; type: string; price: string; origQty: string; executedQty: string; status: string; time: number }
    const [acct, orders] = await Promise.all([
      fetch(`${base}/api/v3/account?${qs}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': binKey } })
        .then(r => { if (!r.ok) throw new Error(`account HTTP ${r.status}`); return r.json() as Promise<BinanceAcct> }),
      fetch(`${base}/api/v3/openOrders?timestamp=${ts}&signature=${createHmac('sha256', binSecret).update(`timestamp=${ts}`).digest('hex')}`, { headers: { 'X-MBX-APIKEY': binKey } })
        .then(r => { if (!r.ok) return [] as BinanceOrder[]; return r.json() as Promise<BinanceOrder[]> }),
    ])
    return {
      id: `binance-${mode.toLowerCase()}`, exchange: 'binance', mode, connected: true,
      balances: acct.balances
        .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
        .map(b => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) }))
        .sort((a, b) => (b.free + b.locked) - (a.free + a.locked)),
      openOrders: orders.map(o => ({
        symbol: o.symbol, side: o.side, type: o.type,
        price: parseFloat(o.price), origQty: parseFloat(o.origQty),
        executedQty: parseFloat(o.executedQty), status: o.status, time: o.time,
      })),
    }
  }

  type BridgeAcctData = { login: number; server: string; trade_mode: number; balance: number; equity: number; margin: number; free_margin: number; profit: number; leverage: number; currency?: string; name?: string }
  type BridgePosition = { ticket: number; symbol: string; side: 'BUY' | 'SELL'; volume: number; priceOpen: number; priceCurrent: number; profit: number; swap: number; sl: number; tp: number; time: string }

  async function fetchMt5Entries(): Promise<Mt5AccountEntry[]> {
    const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`

    // Identify the currently active account — MT5 only supports one active connection at a time
    type HealthData = { connected: boolean; account?: { login: number; server: string; trade_mode: number } }
    const health = await fetch(`${base}/health`)
      .then(r => r.ok ? r.json() as Promise<HealthData> : { connected: false } as HealthData)
      .catch(() => ({ connected: false } as HealthData))
    const activeLogin = (health as HealthData).account?.login

    // Get registered accounts list
    const accountsRes = await fetch(`${base}/accounts`)
    if (!accountsRes.ok) throw new Error(`MT5 bridge HTTP ${accountsRes.status}`)
    const accountsData = await accountsRes.json() as { accounts: Array<{ login: number; name?: string; server?: string }> }

    if (accountsData.accounts.length === 0) {
      // No registered accounts — return the currently active account only
      const fullAcct = await fetch(`${base}/account`).then(r => r.ok ? r.json() as Promise<BridgeAcctData> : null).catch(() => null)
      const positions = await fetch(`${base}/positions`).then(r => r.ok ? r.json() as Promise<BridgePosition[]> : [] as BridgePosition[]).catch(() => [] as BridgePosition[])
      const mode = fullAcct?.trade_mode === 2 ? 'LIVE' : 'DEMO'
      return [{
        id: `mt5-${activeLogin ?? 'unknown'}`,
        exchange: 'mt5', mode, connected: (health as HealthData).connected,
        summary: fullAcct ? { balance: fullAcct.balance, equity: fullAcct.equity, margin: fullAcct.margin, freeMargin: fullAcct.free_margin, profit: fullAcct.profit, leverage: fullAcct.leverage, login: fullAcct.login, server: fullAcct.server } : undefined,
        positions,
      }]
    }

    // MT5 can only serve the currently active account — fetch data only for that account.
    // Other registered accounts are shown as inactive (no error — just not connected right now).
    const results = await Promise.all(
      accountsData.accounts.map(async (acc): Promise<Mt5AccountEntry> => {
        // If this account is NOT the active one, show it as inactive rather than trying to fetch
        if (activeLogin !== undefined && acc.login !== activeLogin) {
          return {
            id: `mt5-${acc.login}`,
            exchange: 'mt5' as const,
            mode: 'DEMO' as const,
            connected: false,
            error: 'Not active — MT5 supports one connection at a time. Switch accounts in the MT5 bridge to view this account.',
          }
        }
        try {
          const [acctData, positions] = await Promise.all([
            fetch(`${base}/account?accountId=${acc.login}`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<BridgeAcctData> }),
            fetch(`${base}/positions?accountId=${acc.login}`).then(r => r.ok ? r.json() as Promise<BridgePosition[]> : [] as BridgePosition[]).catch(() => [] as BridgePosition[]),
          ])
          const mode = acctData.trade_mode === 2 ? 'LIVE' : 'DEMO'
          return {
            id: `mt5-${acc.login}`,
            exchange: 'mt5' as const, mode, connected: true,
            summary: { balance: acctData.balance, equity: acctData.equity, margin: acctData.margin, freeMargin: acctData.free_margin, profit: acctData.profit, leverage: acctData.leverage, login: acctData.login, server: acctData.server },
            positions,
          }
        } catch (e) {
          return { id: `mt5-${acc.login}`, exchange: 'mt5' as const, mode: 'DEMO' as const, connected: false, error: e instanceof Error ? e.message : `Failed to fetch account ${acc.login}` }
        }
      })
    )
    return results
  }

  // ── Symbol search ────────────────────────────────────────────────────────────
  const CRYPTO_SYMBOLS = [
    'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOTUSDT',
    'LINKUSDT','LTCUSDT','MATICUSDT','UNIUSDT','ATOMUSDT','ETCUSDT','XLMUSDT','ALGOUSDT',
    'VETUSDT','FILUSDT','THETAUSDT','AAVEUSDT','MKRUSDT','AXSUSDT','SANDUSDT','MANAUSDT',
    'DOGEUSDT','SHIBUSDT','TRXUSDT','NEARUSDT','FTMUSDT','HBARUSDT','ICPUSDT','EGLDUSDT',
  ]
  app.get('/api/symbols', async (req, reply) => {
    const { market, search = '', accountId } = req.query as { market?: string; search?: string; accountId?: string }
    const q = (search as string).toLowerCase()

    if (market === 'mt5') {
      const bridgeBase = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`
      try {
        const params = new URLSearchParams()
        if (q) params.set('search', q)
        if (accountId) params.set('accountId', accountId)
        const res = await fetch(`${bridgeBase}/symbols?${params}`)
        if (!res.ok) return reply.status(502).send({ error: 'MT5 bridge error' })
        const data = await res.json() as Array<{ name: string; description: string }>
        return reply.send(data.slice(0, 100).map(s => ({ symbol: s.name, description: s.description })))
      } catch {
        return reply.status(502).send({ error: 'MT5 bridge unavailable' })
      }
    }

    if (market === 'crypto') {
      const results = q ? CRYPTO_SYMBOLS.filter(s => s.toLowerCase().includes(q)) : CRYPTO_SYMBOLS
      return reply.send(results.map(s => ({ symbol: s, description: s.replace('USDT', ' / USDT') })))
    }

    return reply.send([])
  })

  // ── OpenRouter models ─────────────────────────────────────────────────────
  app.get('/api/openrouter/models', async (_req, reply) => {
    const key = process.env.OPENROUTER_API_KEY
    if (!key) return reply.status(400).send({ error: 'OPENROUTER_API_KEY not set' })
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` },
    })
    if (!res.ok) return reply.status(502).send({ error: `OpenRouter HTTP ${res.status}` })
    const data = await res.json() as {
      data: Array<{ id: string; name: string; context_length: number; pricing?: { prompt?: string; completion?: string } }>
    }
    const models = data.data
      .map(m => ({
        id: m.id,
        name: m.name || m.id,
        contextLength: m.context_length ?? 0,
        promptCost: m.pricing?.prompt,
        completionCost: m.pricing?.completion,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return reply.send(models)
  })

  app.get('/api/ollama/models', async (_req, reply) => {
    const baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
    try {
      const res = await fetch(`${baseUrl}/api/tags`)
      if (!res.ok) return reply.status(502).send({ error: `Ollama HTTP ${res.status}` })
      const data = await res.json() as {
        models: Array<{ name: string; model: string; size: number; details?: { parameter_size?: string; family?: string } }>
      }
      const models = data.models.map(m => ({
        id: m.name,
        name: m.name,
        size: m.details?.parameter_size ?? '',
        family: m.details?.family ?? '',
      }))
      return reply.send(models)
    } catch {
      return reply.status(502).send({ error: `Ollama is not reachable at ${baseUrl}` })
    }
  })

  app.get('/api/mt5-accounts', async (_req, reply) => {
    const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`
    try {
      const accountsRes = await fetch(`${base}/accounts`)
      if (!accountsRes.ok) return reply.status(502).send({ error: 'MT5 bridge unavailable' })
      const data = await accountsRes.json() as { accounts: Array<{ login: number; name?: string; server?: string }> }
      const enriched = await Promise.all(
        data.accounts.map(async (acc) => {
          const acctData = await fetch(`${base}/account?accountId=${acc.login}`)
            .then(r => r.ok ? r.json() as Promise<BridgeAcctData> : null)
            .catch(() => null)
          return {
            login: acc.login,
            name: acc.name ?? `Account ${acc.login}`,
            server: acc.server ?? '',
            balance: acctData?.balance ?? null,
            equity: acctData?.equity ?? null,
            currency: acctData?.currency ?? 'USD',
            mode: (acctData?.trade_mode === 2 ? 'LIVE' : 'DEMO') as 'LIVE' | 'DEMO',
          }
        })
      )
      return reply.send(enriched)
    } catch (e) {
      return reply.status(502).send({ error: e instanceof Error ? e.message : 'Bridge error' })
    }
  })

  app.get('/api/accounts', async (_req, reply) => {
    const jobs: Array<Promise<AccountEntry>> = []
    if (process.env.BINANCE_API_KEY)  jobs.push(fetchBinanceEntry().catch(err => ({ id: 'binance-main', exchange: 'binance' as const, mode: (process.env.BINANCE_TESTNET === 'true' ? 'TESTNET' : 'LIVE') as 'LIVE' | 'TESTNET', connected: false, error: String(err) })))
    // MT5 bridge — try all registered accounts; silently skip if bridge is not running
    const mt5Entries = await fetchMt5Entries().catch(() => [{ id: 'mt5-unknown', exchange: 'mt5' as const, mode: 'DEMO' as const, connected: false, error: 'Bridge not running' } as Mt5AccountEntry])
    mt5Entries.forEach(e => jobs.push(Promise.resolve(e)))
    const accounts = await Promise.all(jobs)
    return reply.send(accounts)
  })

  // ── Positions ────────────────────────────────────────────────────────────────
  app.get('/api/positions', async (_req, reply) => {
    const agents = Object.values(getState().agents)
    if (agents.length === 0) return []
    const results = await Promise.allSettled(
      agents.map(async (agent) => {
        const adapter = getAdapter(agent.config.market as 'crypto' | 'mt5', agent.config.mt5AccountId)
        const orders = await adapter.getOpenOrders(agent.config.symbol)
        return orders.map(o => ({
          ...o,
          agentKey: makeAgentKey(agent.config.market, agent.config.symbol, agent.config.mt5AccountId, agent.config.name),
          market: agent.config.market,
          paper: false,
        }))
      })
    )
    const positions = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
    return reply.send(positions)
  })

  app.post('/api/orders/:ticket/cancel', async (req, reply) => {
    const ticket = parseInt((req.params as { ticket: string }).ticket, 10)
    const { agentKey } = req.body as { agentKey: string }
    const agentState = getState().agents[agentKey]
    if (!agentState) return reply.status(404).send({ error: 'Agent not found' })
    const adapter = getAdapter(agentState.config.market as 'crypto' | 'mt5', agentState.config.mt5AccountId)
    await adapter.cancelOrder(agentState.config.symbol, ticket)
    return reply.send({ ok: true, ticket })
  })

  app.post('/api/positions/:ticket/close', async (req, reply) => {
    const ticket = parseInt((req.params as { ticket: string }).ticket, 10)
    const { agentKey, volume } = req.body as { agentKey: string; volume?: number }
    const agentState = getState().agents[agentKey]
    if (!agentState) return reply.status(404).send({ error: 'Agent not found' })
    const adapter = getAdapter(agentState.config.market as 'crypto' | 'mt5', agentState.config.mt5AccountId)
    const mt5 = adapter as import('../adapters/mt5.js').MT5Adapter
    if (typeof mt5.closePosition !== 'function') return reply.status(400).send({ error: 'close not supported for this market' })
    const result = await mt5.closePosition(ticket, volume)
    return reply.send(result)
  })

  app.post('/api/positions/:ticket/modify', async (req, reply) => {
    const ticket = parseInt((req.params as { ticket: string }).ticket, 10)
    const { agentKey, sl, tp } = req.body as { agentKey: string; sl?: number; tp?: number }
    const agentState = getState().agents[agentKey]
    if (!agentState) return reply.status(404).send({ error: 'Agent not found' })
    const adapter = getAdapter(agentState.config.market as 'crypto' | 'mt5', agentState.config.mt5AccountId)
    const mt5 = adapter as import('../adapters/mt5.js').MT5Adapter
    if (typeof mt5.modifyPosition !== 'function') return reply.status(400).send({ error: 'modify not supported for this market' })
    const result = await mt5.modifyPosition(ticket, sl, tp)
    return reply.send(result)
  })

  app.get('/api/trades', async (_req, reply) => {
    const agents = Object.values(getState().agents)
    if (agents.length === 0) return []
    const results = await Promise.allSettled(
      agents.map(async (agent) => {
        const adapter = getAdapter(agent.config.market as 'crypto' | 'mt5', agent.config.mt5AccountId)
        const fills = await adapter.getTradeHistory(agent.config.symbol, 50)
        return fills.map(f => ({
          ...f,
          agentKey: makeAgentKey(agent.config.market, agent.config.symbol, agent.config.mt5AccountId, agent.config.name),
          market: agent.config.market,
          paper: false,
        }))
      })
    )
    const trades = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
      .sort((a, b) => b.time - a.time)
    return reply.send(trades)
  })

  // ── Agent Strategy ────────────────────────────────────────────────────────────
  app.get('/api/agents/:key/strategy', async (req) => {
    const { key } = req.params as { key: string }
    return dbGetStrategy(key) ?? {}
  })

  app.put('/api/agents/:key/strategy', async (req, reply) => {
    const { key } = req.params as { key: string }
    const body = req.body as Omit<import('../db/index.js').StrategyDoc, 'agentKey' | 'createdAt' | 'updatedAt'>
    dbSaveStrategy({ ...body, agentKey: key })
    return reply.send({ ok: true })
  })

  app.delete('/api/agents/:key/strategy', async (req, reply) => {
    const { key } = req.params as { key: string }
    dbDeleteStrategy(key)
    return reply.send({ ok: true })
  })

  // ── Agent Memory ──────────────────────────────────────────────────────────────
  app.get('/api/agents/:key/memories', async (req) => {
    const { key } = req.params as { key: string }
    const { category } = req.query as { category?: string }
    return dbGetMemories(key, category, 100)
  })

  app.delete('/api/agents/:key/memories', async (req, reply) => {
    const { key } = req.params as { key: string }
    dbClearMemories(key)
    return reply.send({ ok: true })
  })

  app.delete('/api/agents/:key/memories/:category/:memKey', async (req, reply) => {
    const { key, category, memKey } = req.params as { key: string; category: string; memKey: string }
    dbDeleteMemory(key, category, decodeURIComponent(memKey))
    return reply.send({ ok: true })
  })

  // ── Reset all agent data (keeps config) ────────────────────────────────────
  app.post('/api/agents/:key/reset', async (req, reply) => {
    const { key } = req.params as { key: string }
    const decoded = decodeURIComponent(key)
    // Stop the agent first if running
    const { stopAgentSchedule } = await import('../scheduler/index.js')
    stopAgentSchedule(decoded)
    setAgentStatus(decoded, 'idle')
    const result = dbResetAgentData(decoded)
    return reply.send({ ok: true, ...result })
  })

  // ── Agent Performance Stats ───────────────────────────────────────────────────
  app.get('/api/agents/:key/stats', async (req, reply) => {
    const { key } = req.params as { key: string }
    const { dbGetAgentStats } = await import('../db/index.js')
    return reply.send(dbGetAgentStats(decodeURIComponent(key)))
  })

  // ── Agent Plans ───────────────────────────────────────────────────────────────
  app.get('/api/agents/:key/plans', async (req) => {
    const { key } = req.params as { key: string }
    return dbGetAllPlans(key, 10)
  })

  app.get('/api/agents/:key/plan/active', async (req) => {
    const { key } = req.params as { key: string }
    return dbGetActivePlan(key) ?? {}
  })

  app.post('/api/agents/:key/plan', async (req, reply) => {
    const { key } = req.params as { key: string }
    const agent = getAgent(key)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    if (agent.status === 'running') {
      // Agent is running — queue the plan request for the next tick
      const { queuePlanRequest } = await import('./state.js')
      queuePlanRequest(key)
      return reply.send({ ok: true, message: 'Planning cycle queued — will run on next tick' })
    }

    // Agent is idle — run immediately
    runAgentTick(agent.config, 'planning').catch(err => log.error({ err, key }, 'planning cycle error'))
    return reply.send({ ok: true, message: 'Planning cycle triggered' })
  })

  // ── Serve React frontend ─────────────────────────────────────────────────────
  const frontendDist = join(__dirname, '../../frontend-dist')
  if (existsSync(frontendDist)) {
    await app.register(fastifyStatic, { root: frontendDist, prefix: '/' })
    app.setNotFoundHandler((_req, reply) => { reply.sendFile('index.html') })
  } else {
    app.get('/', async (_req, reply) => {
      reply.type('text/html').send(`
        <html><body style="background:#0d0d0d;color:#e0e0e0;font-family:monospace;padding:40px">
          <h2 style="color:#00e676">Wolf-Fin API running</h2>
          <p>Frontend: run <code>cd frontend && pnpm dev</code> then open <a style="color:#00e676" href="http://localhost:5173">localhost:5173</a></p>
          <p>API: <a style="color:#00e676" href="/api/status">/api/status</a></p>
        </body></html>
      `)
    })
  }

  await app.listen({ port: PORT, host: '0.0.0.0' })
  log.info({ port: PORT }, `server running at http://localhost:${PORT}`)

  // ── Startup connectivity checks ──────────────────────────────────────────────
  const services = ['anthropic', 'binance', 'finnhub', 'twelvedata', 'coingecko']
  log.info('checking service connectivity...')
  for (const service of services) {
    testConnection(service).then(result => {
      if (result.ok) {
        log.info({ service }, `[${service}] ${result.message}`)
      } else {
        log.warn({ service }, `[${service}] ${result.message}`)
      }
    }).catch(err => {
      log.warn({ service, err }, `[${service}] check failed`)
    })
  }
}
