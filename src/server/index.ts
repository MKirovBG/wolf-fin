// Wolf-Fin — HTTP dashboard server

import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'fs'
import pino from 'pino'
import {
  dbGetAllSymbols, dbGetSymbol, dbUpsertSymbol, dbDeleteSymbol,
  dbGetAnalyses, dbGetLatestAnalysis, dbGetAllRecentAnalyses, dbGetAnalysisById,
  dbGetAllMt5Accounts, dbUpsertMt5Accounts, dbMarkMt5AccountsGone,
  dbGetSetting, dbSetSetting,
  dbGetAllStrategies, dbGetStrategy, dbUpsertStrategy, dbDeleteStrategy,
  dbGetOutcomes, dbGetOutcomeStats, dbGetPendingOutcomes,
  dbGetLatestFeatures, dbGetLatestMarketState,
  dbGetLatestCandidates,
  dbGetStrategyVersions,
  dbCreateBacktestRun, dbCompleteBacktestRun, dbFailBacktestRun, dbGetBacktestRun, dbSaveBacktestTrades,
  dbCreateAlertRule, dbGetAlertRules, dbToggleAlertRule, dbDeleteAlertRule,
  dbFireAlert, dbGetAlertFirings, dbAcknowledgeAlert, dbGetLatestFeatureHistory,
  dbGetFeaturesForAnalysis,
  makeSymbolKey,
} from '../db/index.js'
import type { Mt5AccountRow } from '../db/index.js'
import { getLogs, subscribeToLogs, subscribeToAnalyses, broadcastAnalysisUpdate } from './state.js'
import { runAnalysis, isAnalysisRunning } from '../analyzer/index.js'
import { syncSchedule, stopSchedule, getScheduledKeys } from '../scheduler/index.js'
import { MT5Adapter, setBridgeActiveLogin } from '../adapters/mt5.js'
import { getPlatformLLMModel, getPlatformLLMProvider, getOpenAITokenStatus, getOpenAIAccessToken } from '../llm/index.js'
import type { WatchSymbol } from '../types.js'
import { fetchCalendarForDisplay } from '../adapters/calendar.js'

const log  = pino({ level: process.env.LOG_LEVEL ?? 'info' })
const PORT = parseInt(process.env.PORT ?? '3000', 10)
const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Helpers ────────────────────────────────────────────────────────────────────

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
        const key = process.env.ANTHROPIC_API_KEY
        if (!key) return { ok: false, message: 'ANTHROPIC_API_KEY not set' }
        const r = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        })
        return r.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `HTTP ${r.status}` }
      }
      case 'anthropic-subscription': {
        const token = process.env.CLAUDE_SESSION_TOKEN
        if (!token) return { ok: false, message: 'CLAUDE_SESSION_TOKEN not set' }
        const r = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'Authorization': `Bearer ${token}`, 'anthropic-version': '2023-06-01' },
        })
        return r.ok ? { ok: true, message: 'Connected (subscription)' } : { ok: false, message: `HTTP ${r.status}` }
      }
      case 'openrouter': {
        const key = process.env.OPENROUTER_API_KEY
        if (!key) return { ok: false, message: 'OPENROUTER_API_KEY not set' }
        const r = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { 'Authorization': `Bearer ${key}` },
        })
        if (!r.ok) return { ok: false, message: `HTTP ${r.status}` }
        return { ok: true, message: 'Connected' }
      }
      case 'finnhub': {
        const key = process.env.FINNHUB_KEY
        if (!key) return { ok: false, message: 'FINNHUB_KEY not set' }
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${key}`)
        return r.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `HTTP ${r.status}` }
      }
      case 'mt5': {
        const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`
        const r = await fetch(`${base}/health`).catch(() => null)
        if (!r || !r.ok) return { ok: false, message: 'Bridge offline' }
        return { ok: true, message: 'Bridge connected' }
      }
      case 'ollama': {
        const baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
        const r = await fetch(`${baseUrl}/api/tags`).catch(() => null)
        return r?.ok ? { ok: true, message: 'Connected' } : { ok: false, message: 'Ollama not running' }
      }
      default:
        return { ok: false, message: `Unknown service: ${service}` }
    }
  } catch (e) {
    return { ok: false, message: String(e) }
  }
}

// ── MT5 account fetching ──────────────────────────────────────────────────────

interface Mt5AccountEntry {
  id: string
  exchange: 'mt5'
  mode: 'DEMO' | 'LIVE'
  connected: boolean
  label?: string
  error?: string
  summary?: {
    login: number
    name?: string
    server?: string
    balance?: number
    equity?: number
    freeMargin?: number
    leverage?: number
    currency?: string
  }
}

async function fetchMt5Entries(): Promise<Mt5AccountEntry[]> {
  const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`
  const key  = process.env.MT5_BRIDGE_KEY ?? ''
  const hdrs = key ? { 'X-Bridge-Key': key } : {}

  type HealthData = { connected: boolean; account?: { login: number; server: string; trade_mode: number } }
  let health: HealthData = { connected: false }
  let bridgeUp = false
  let bridgeAccounts: Array<{ login: number; name?: string; server?: string }> = []

  try {
    health = await fetch(`${base}/health`, { headers: hdrs })
      .then(r => r.ok ? r.json() as Promise<HealthData> : { connected: false })
      .catch(() => ({ connected: false }))

    const accRes = await fetch(`${base}/accounts`, { headers: hdrs })
    if (accRes.ok) {
      const d = await accRes.json() as { accounts: typeof bridgeAccounts }
      bridgeAccounts = d.accounts ?? []
      bridgeUp = true
    }
  } catch { /* bridge offline */ }

  const activeLogin = (health as { account?: { login: number } }).account?.login
  if (activeLogin != null) setBridgeActiveLogin(activeLogin)

  // Persist known accounts to DB
  if (bridgeUp) {
    dbMarkMt5AccountsGone()
    const toUpsert: Mt5AccountRow[] = bridgeAccounts.map(a => ({
      login:      a.login,
      name:       a.name ?? '',
      server:     a.server ?? '',
      mode:       'DEMO',
      lastSeenAt: new Date().toISOString(),
      inBridge:   true,
    }))
    if (activeLogin != null && !toUpsert.some(a => a.login === activeLogin)) {
      toUpsert.push({
        login:      activeLogin,
        name:       '',
        server:     '',
        mode:       (health.account as { trade_mode?: number })?.trade_mode === 0 ? 'DEMO' : 'LIVE',
        lastSeenAt: new Date().toISOString(),
        inBridge:   true,
      })
    }
    if (toUpsert.length > 0) dbUpsertMt5Accounts(toUpsert)
  }

  const allKnown = dbGetAllMt5Accounts()

  if (allKnown.length === 0) {
    return [{ id: 'mt5-unknown', exchange: 'mt5', mode: 'DEMO', connected: false,
              error: bridgeUp ? 'No accounts found in bridge' : 'MT5 bridge offline' }]
  }

  return allKnown.map(acct => {
    const isActive   = activeLogin != null && acct.login === activeLogin
    const inBridge   = acct.inBridge && bridgeUp
    const mode = acct.mode === 'LIVE' ? 'LIVE' : 'DEMO'
    return {
      id:        `mt5-${acct.login}`,
      exchange:  'mt5' as const,
      mode:      mode as 'DEMO' | 'LIVE',
      connected: isActive,
      label:     acct.name || acct.server || `MT5 #${acct.login}`,
      error:     !inBridge ? `Last seen: ${new Date(acct.lastSeenAt).toLocaleString()}` : undefined,
      summary:   { login: acct.login, name: acct.name, server: acct.server },
    }
  })
}

// ── Server ─────────────────────────────────────────────────────────────────────

export async function startServer(): Promise<void> {
  const app = Fastify({ logger: false })

  // ── Watch symbols CRUD ───────────────────────────────────────────────────────

  app.get('/api/symbols', async () => {
    return dbGetAllSymbols()
  })

  app.get('/api/symbols/:key', async (req, reply) => {
    const { key } = req.params as { key: string }
    const sym = dbGetSymbol(key)
    if (!sym) return reply.status(404).send({ error: 'Symbol not found' })
    return sym
  })

  app.post('/api/symbols', async (req, reply) => {
    const body = req.body as Partial<WatchSymbol> & { symbol: string }
    if (!body.symbol) return reply.status(400).send({ error: 'symbol is required' })

    const symbol  = body.symbol.toUpperCase().replace(/_/g, '')
    const key     = makeSymbolKey(symbol, body.mt5AccountId)

    if (dbGetSymbol(key)) {
      return reply.status(409).send({ error: `Symbol ${symbol} already in watchlist` })
    }

    const sym: WatchSymbol = {
      key,
      symbol,
      market:             'mt5',
      displayName:        body.displayName,
      mt5AccountId:       body.mt5AccountId,
      scheduleEnabled:    body.scheduleEnabled ?? false,
      scheduleIntervalMs: body.scheduleIntervalMs,
      scheduleStartUtc:   body.scheduleStartUtc,
      scheduleEndUtc:     body.scheduleEndUtc,
      indicatorConfig:    body.indicatorConfig,
      candleConfig:       body.candleConfig,
      contextConfig:      body.contextConfig,
      llmProvider:        body.llmProvider,
      llmModel:           body.llmModel,
      createdAt:          new Date().toISOString(),
    }

    dbUpsertSymbol(sym)
    syncSchedule(sym)

    return reply.status(201).send({ ok: true, key })
  })

  app.patch('/api/symbols/:key', async (req, reply) => {
    const { key } = req.params as { key: string }
    const existing = dbGetSymbol(key)
    if (!existing) return reply.status(404).send({ error: 'Symbol not found' })

    const patch = req.body as Partial<WatchSymbol>
    const updated: WatchSymbol = {
      ...existing,
      ...patch,
      key,           // never change the key
      symbol:        existing.symbol,
      market:        existing.market,
      createdAt:     existing.createdAt,
    }

    dbUpsertSymbol(updated)
    syncSchedule(updated)

    return { ok: true }
  })

  app.delete('/api/symbols/:key', async (req, reply) => {
    const { key } = req.params as { key: string }
    if (!dbGetSymbol(key)) return reply.status(404).send({ error: 'Symbol not found' })
    stopSchedule(key)
    dbDeleteSymbol(key)
    return { ok: true }
  })

  // ── Analysis ──────────────────────────────────────────────────────────────────

  app.post('/api/symbols/:key/analyze', async (req, reply) => {
    const { key } = req.params as { key: string }
    const sym = dbGetSymbol(key)
    if (!sym) return reply.status(404).send({ error: 'Symbol not found' })
    if (isAnalysisRunning(key)) return reply.status(409).send({ error: 'Analysis already running' })

    // Run in background — return immediately, client polls or listens to SSE
    runAnalysis(key)
      .then(result => broadcastAnalysisUpdate(key, result.id))
      .catch(err => log.error({ symbolKey: key, err }, 'manual analysis failed'))

    return { ok: true, message: 'Analysis started' }
  })

  app.get('/api/symbols/:key/analyses', async (req, reply) => {
    const { key }   = req.params as { key: string }
    const { limit } = req.query as { limit?: string }
    if (!dbGetSymbol(key)) return reply.status(404).send({ error: 'Symbol not found' })
    return dbGetAnalyses(key, limit ? parseInt(limit) : 50)
  })

  app.get('/api/symbols/:key/analyses/latest', async (req, reply) => {
    const { key } = req.params as { key: string }
    const result = dbGetLatestAnalysis(key)
    if (!result) return reply.status(404).send({ error: 'No analyses yet' })
    return result
  })

  app.get('/api/analyses', async (req) => {
    const { limit } = req.query as { limit?: string }
    return dbGetAllRecentAnalyses(limit ? parseInt(limit) : 100)
  })

  app.get('/api/analyses/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const result = dbGetAnalysisById(parseInt(id))
    if (!result) return reply.status(404).send({ error: 'Analysis not found' })
    return result
  })

  // Running state
  app.get('/api/symbols/:key/running', async (req) => {
    const { key } = req.params as { key: string }
    return { running: isAnalysisRunning(key) }
  })

  // Prompt preview — returns the effective system prompt for a symbol without calling the LLM
  app.get('/api/symbols/:key/prompt', async (req, reply) => {
    const { key } = req.params as { key: string }
    const sym = dbGetSymbol(key)
    if (!sym) return reply.status(404).send({ error: 'Symbol not found' })
    const { buildSystemPrompt } = await import('../analyzer/prompt.js')
    const stratRow = sym.strategy ? dbGetStrategy(sym.strategy) : null
    return reply.send({
      systemPrompt: buildSystemPrompt({ strategyInstructions: stratRow?.instructions, customPrompt: sym.systemPrompt }),
      strategy:     sym.strategy ?? null,
      strategyName: stratRow?.name ?? null,
      hasCustom:    !!(sym.systemPrompt?.trim()),
    })
  })

  // ── Strategies ────────────────────────────────────────────────────────────────

  app.get('/api/strategies', async (_req, reply) => {
    return reply.send(dbGetAllStrategies())
  })

  app.post('/api/strategies', async (req, reply) => {
    const body = req.body as { key?: string; name?: string; description?: string; instructions?: string }
    if (!body.key?.trim() || !body.name?.trim() || !body.instructions?.trim()) {
      return reply.status(400).send({ error: 'key, name and instructions are required' })
    }
    // Prevent overwriting builtins via POST
    const existing = dbGetStrategy(body.key.trim())
    if (existing?.isBuiltin) return reply.status(409).send({ error: 'Cannot overwrite a built-in strategy via POST — use PATCH' })
    dbUpsertStrategy({ key: body.key.trim(), name: body.name.trim(), description: body.description, instructions: body.instructions.trim() })
    return reply.send({ ok: true })
  })

  app.patch('/api/strategies/:key', async (req, reply) => {
    const { key } = req.params as { key: string }
    const body = req.body as { name?: string; description?: string; instructions?: string }
    const existing = dbGetStrategy(key)
    if (!existing) return reply.status(404).send({ error: 'Strategy not found' })
    dbUpsertStrategy({
      key,
      name:         body.name?.trim()         ?? existing.name,
      description:  body.description          ?? existing.description ?? undefined,
      instructions: body.instructions?.trim() ?? existing.instructions,
    })
    return reply.send({ ok: true })
  })

  app.delete('/api/strategies/:key', async (req, reply) => {
    const { key } = req.params as { key: string }
    const existing = dbGetStrategy(key)
    if (!existing) return reply.status(404).send({ error: 'Strategy not found' })
    if (existing.isBuiltin) return reply.status(403).send({ error: 'Built-in strategies cannot be deleted' })
    dbDeleteStrategy(key)
    return reply.send({ ok: true })
  })

  // Backtest — evaluate stored analyses with trade proposals
  app.get('/api/symbols/:key/backtest', async (req, reply) => {
    const { key } = req.params as { key: string }
    const query   = req.query as { lookForward?: string; minRR?: string }
    const minRR   = parseFloat(query.minRR ?? '1.5')

    const analyses = dbGetAnalyses(key, 200)
    const proposals = analyses.filter(a =>
      a.tradeProposal !== null &&
      a.tradeProposal.direction !== null &&
      (a.tradeProposal.riskReward ?? 0) >= minRR &&
      !a.error
    )

    const results = proposals.map(a => ({
      analysisId: a.id,
      time:       a.time,
      bias:       a.bias,
      direction:  a.tradeProposal?.direction ?? null,
      entryLow:   a.tradeProposal?.entryZone?.low  ?? 0,
      entryHigh:  a.tradeProposal?.entryZone?.high ?? 0,
      sl:         a.tradeProposal?.stopLoss        ?? 0,
      tp1:        a.tradeProposal?.takeProfits?.[0] ?? 0,
      rr:         a.tradeProposal?.riskReward       ?? 0,
      confidence: a.tradeProposal?.confidence       ?? 'medium',
    }))

    return reply.send(results)
  })

  // Live candles proxy — fetches fresh candles from MT5 bridge for the chart
  app.get('/api/symbols/:key/candles', async (req, reply) => {
    const { key } = req.params as { key: string }
    const query   = req.query as { timeframe?: string; count?: string }

    const sym = dbGetSymbol(key)
    if (!sym) return reply.status(404).send({ error: 'Symbol not found' })

    const tf    = query.timeframe ?? sym.candleConfig?.primaryTimeframe ?? 'h1'
    const count = parseInt(query.count ?? '200', 10)

    // Map internal timeframe codes to MT5 bridge format
    const TF_MAP: Record<string, string> = {
      m1: 'M1', m5: 'M5', m15: 'M15', m30: 'M30', h1: 'H1', h4: 'H4',
    }
    const bridgeTf = TF_MAP[tf] ?? 'H1'

    const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`
    const key_ = process.env.MT5_BRIDGE_KEY ?? ''
    const hdrs = key_ ? { 'X-Bridge-Key': key_ } : {}

    try {
      const r = await fetch(
        `${base}/candles/${encodeURIComponent(sym.symbol)}?timeframe=${bridgeTf}&count=${count}`,
        { headers: hdrs },
      )
      if (!r.ok) return reply.status(502).send({ error: `Bridge returned ${r.status}` })

      const body = await r.json() as { candles: Array<{ openTime: number; open: number; high: number; low: number; close: number; volume: number }> }
      const raw = body.candles ?? []
      // Convert ms → seconds for lightweight-charts
      const candles = raw.map(c => ({
        time:   Math.floor(c.openTime / 1000),
        open:   c.open,
        high:   c.high,
        low:    c.low,
        close:  c.close,
        volume: c.volume,
      }))
      return reply.send(candles)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(502).send({ error: `Bridge unreachable: ${msg}` })
    }
  })

  // Scheduled symbols
  app.get('/api/scheduled', async () => {
    return { keys: getScheduledKeys() }
  })

  // ── Logs ──────────────────────────────────────────────────────────────────────

  app.get('/api/logs', async (req) => {
    const { sinceId, symbolKey, limit } = req.query as {
      sinceId?: string; symbolKey?: string; limit?: string
    }
    return getLogs(
      sinceId ? parseInt(sinceId) : undefined,
      symbolKey,
      limit ? parseInt(limit) : 200,
    )
  })

  // SSE: real-time log stream
  app.get('/api/logs/stream', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    const unsub = subscribeToLogs(entry => {
      reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`)
    })
    req.raw.on('close', unsub)
    reply.raw.write(': connected\n\n')
    return reply
  })

  // SSE: analysis completion events
  app.get('/api/analyses/stream', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    const unsub = subscribeToAnalyses(event => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    })
    req.raw.on('close', unsub)
    reply.raw.write(': connected\n\n')
    return reply
  })

  // ── MT5 Accounts ──────────────────────────────────────────────────────────────

  app.get('/api/accounts', async (_req, reply) => {
    const mt5Entries = await fetchMt5Entries().catch(() => [
      { id: 'mt5-unknown', exchange: 'mt5' as const, mode: 'DEMO' as const, connected: false, error: 'Bridge offline' }
    ])
    return reply.send(mt5Entries)
  })

  app.get('/api/mt5-accounts', async (_req, reply) => {
    const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`
    const key  = process.env.MT5_BRIDGE_KEY ?? ''
    const hdrs = key ? { 'X-Bridge-Key': key } : {}

    try {
      const health = await fetch(`${base}/health`, { headers: hdrs })
        .then(r => r.ok ? r.json() as Promise<{ account?: { login: number } }> : {})
        .catch(() => ({}))
      const activeLogin = (health as { account?: { login: number } }).account?.login

      const allKnown = dbGetAllMt5Accounts()
      return reply.send(allKnown.map(a => ({
        login:    a.login,
        name:     a.name,
        server:   a.server,
        mode:     a.mode,
        active:   activeLogin === a.login,
        inBridge: a.inBridge,
      })))
    } catch {
      return reply.send(dbGetAllMt5Accounts())
    }
  })

  // MT5 positions for a given account (proxied from bridge)
  app.get('/api/accounts/:id/positions', async (_req, reply) => {
    const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`
    const key  = process.env.MT5_BRIDGE_KEY ?? ''
    const hdrs = key ? { 'X-Bridge-Key': key } : {}
    try {
      const r = await fetch(`${base}/positions`, { headers: hdrs })
      if (!r.ok) return reply.send([])
      const data = await r.json() as { positions?: unknown[] } | unknown[]
      return reply.send(Array.isArray(data) ? data : (data as { positions?: unknown[] }).positions ?? [])
    } catch {
      return reply.send([])
    }
  })

  // MT5 bridge health pass-through
  app.get('/api/mt5/health', async (_req, reply) => {
    const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`
    try {
      const r = await fetch(`${base}/health`)
      const data = await r.json()
      return reply.send(data)
    } catch {
      return reply.status(503).send({ connected: false, error: 'Bridge offline' })
    }
  })

  // Symbol search (for add symbol form)
  app.get('/api/symbols/search', async (req, reply) => {
    const { q, accountId } = req.query as { q?: string; accountId?: string }
    if (!q || q.length < 1) return reply.send([])
    const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`
    try {
      const url = `${base}/symbols?search=${encodeURIComponent(q)}`
      const r = await fetch(url)
      if (!r.ok) return reply.send([])
      const raw = await r.json() as Array<{ name: string; description: string }> | { symbols?: Array<{ name: string; description: string }> }
      const list = Array.isArray(raw) ? raw : (raw.symbols ?? [])
      const symbols = list.slice(0, 50).map(s => ({
        symbol: s.name,
        description: s.description,
      }))
      return reply.send(symbols)
    } catch {
      // Fallback: return query as a symbol candidate
      return reply.send([{ symbol: q.toUpperCase(), description: q.toUpperCase() }])
    }
  })

  // ── LLM / Integration config ──────────────────────────────────────────────────

  app.get('/api/keys', async () => {
    return {
      anthropicApiKey:    !!process.env.ANTHROPIC_API_KEY?.trim(),
      claudeSessionToken: !!process.env.CLAUDE_SESSION_TOKEN?.trim(),
      openrouterApiKey:   !!process.env.OPENROUTER_API_KEY?.trim(),
      finnhubKey:         !!process.env.FINNHUB_KEY?.trim(),
      ollamaUrl:          process.env.OLLAMA_URL || null,
      openaiStatus:       getOpenAITokenStatus(),
    }
  })

  app.post('/api/keys', async (req) => {
    const body = req.body as Record<string, string>
    const allowed = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'FINNHUB_KEY', 'OLLAMA_URL']
    for (const key of allowed) {
      if (body[key] != null) persistEnvKey(key, body[key])
    }
    return { ok: true }
  })

  app.post('/api/test-connection', async (req) => {
    const { service } = req.body as { service: string }
    return testConnection(service)
  })

  // Platform LLM config
  app.get('/api/platform-llm', async () => {
    return {
      provider: process.env.PLATFORM_LLM_PROVIDER || 'anthropic',
      model:    getPlatformLLMModel(),
    }
  })

  app.post('/api/platform-llm', async (req) => {
    const { provider, model } = req.body as { provider: string; model: string }
    const validProviders = ['anthropic', 'anthropic-subscription', 'openrouter', 'ollama', 'openai-subscription']
    if (!validProviders.includes(provider)) return { ok: false, message: 'Invalid provider' }
    persistEnvKey('PLATFORM_LLM_PROVIDER', provider)
    persistEnvKey('PLATFORM_LLM_MODEL', model ?? '')
    process.env.PLATFORM_LLM_PROVIDER = provider
    process.env.PLATFORM_LLM_MODEL    = model ?? ''
    return { ok: true }
  })

  // Anthropic model list
  app.get('/api/anthropic/models', async (_req, reply) => {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) return reply.status(400).send({ error: 'ANTHROPIC_API_KEY not set' })
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    })
    if (!res.ok) return reply.status(502).send({ error: `Anthropic HTTP ${res.status}` })
    const data = await res.json() as { data: Array<{ id: string; display_name: string }> }
    return reply.send(data.data.map(m => ({ id: m.id, name: m.display_name ?? m.id })))
  })

  // OpenRouter model list
  app.get('/api/openrouter/models', async (_req, reply) => {
    const key = process.env.OPENROUTER_API_KEY
    if (!key) return reply.status(400).send({ error: 'OPENROUTER_API_KEY not set' })
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` },
    })
    if (!res.ok) return reply.status(502).send({ error: `OpenRouter HTTP ${res.status}` })
    const data = await res.json() as { data: Array<{ id: string; name: string }> }
    return reply.send(data.data.map(m => ({ id: m.id, name: m.name ?? m.id })))
  })

  // Ollama model list
  app.get('/api/ollama/models', async (_req, reply) => {
    const base = process.env.OLLAMA_URL || 'http://localhost:11434'
    const res = await fetch(`${base}/api/tags`).catch(() => null)
    if (!res?.ok) return reply.status(503).send({ error: 'Ollama not reachable' })
    const data = await res.json() as { models: Array<{ name: string }> }
    return reply.send((data.models ?? []).map(m => ({ id: m.name, name: m.name })))
  })

  // ── Claude / OpenAI auth ──────────────────────────────────────────────────────

  const CLAUDE_CLIENT_ID    = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
  const CLAUDE_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
  const pkceStore = new Map<string, { verifier: string; createdAt: number }>()

  app.post('/api/auth/claude/import-from-cli', async (_req, reply) => {
    try {
      const { homedir } = await import('os')
      const credPath = join(homedir(), '.claude', '.credentials.json')
      if (!existsSync(credPath)) {
        return reply.status(404).send({ ok: false, message: 'Claude Code credentials not found' })
      }
      const creds = JSON.parse(readFileSync(credPath, 'utf8')) as {
        claudeAiOauth?: { accessToken?: string; subscriptionType?: string }
      }
      const token = creds?.claudeAiOauth?.accessToken
      if (!token) return reply.status(400).send({ ok: false, message: 'No access token in credentials' })
      persistEnvKey('CLAUDE_SESSION_TOKEN', token)
      return { ok: true, subscriptionType: creds?.claudeAiOauth?.subscriptionType ?? 'unknown' }
    } catch (e) {
      return reply.status(500).send({ ok: false, message: String(e) })
    }
  })

  app.get('/api/auth/claude/start', async () => {
    const { randomBytes, createHash } = await import('crypto')
    const verifier  = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state     = randomBytes(16).toString('base64url')
    pkceStore.set(state, { verifier, createdAt: Date.now() })
    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     CLAUDE_CLIENT_ID,
      redirect_uri:  CLAUDE_REDIRECT_URI,
      scope:         'openid',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    })
    return { url: `https://claude.ai/oauth/authorize?${params}`, state }
  })

  app.post('/api/auth/claude/exchange', async (req, reply) => {
    const { code, state } = req.body as { code: string; state: string }
    const stored = state ? pkceStore.get(state) : null
    if (!stored) return reply.status(400).send({ ok: false, message: 'State expired — restart auth flow' })
    pkceStore.delete(state)
    try {
      const tokenRes = await fetch('https://console.anthropic.com/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type:    'authorization_code',
          client_id:     CLAUDE_CLIENT_ID,
          code,
          redirect_uri:  CLAUDE_REDIRECT_URI,
          code_verifier: stored.verifier,
        }),
      })
      if (!tokenRes.ok) {
        const err = await tokenRes.text()
        return reply.status(tokenRes.status).send({ ok: false, message: err })
      }
      const data = await tokenRes.json() as { access_token: string }
      persistEnvKey('CLAUDE_SESSION_TOKEN', data.access_token)
      return { ok: true }
    } catch (e) {
      return reply.status(500).send({ ok: false, message: String(e) })
    }
  })

  // OpenAI OAuth (PKCE)
  const OPENAI_CLIENT_ID    = 'app_EMoamEEZ73f0CkXaXp7hrann'
  const OPENAI_AUTH_URL     = 'https://auth.openai.com/oauth/authorize'
  const OPENAI_TOKEN_URL    = 'https://auth.openai.com/oauth/token'
  const OPENAI_REDIRECT_URI = 'http://localhost:1455/auth/callback'
  const OPENAI_SCOPES       = 'openid profile email offline_access'
  const openAIPkceStore     = new Map<string, { verifier: string; createdAt: number }>()

  app.get('/api/auth/openai/start', async () => {
    const { randomBytes, createHash } = await import('crypto')
    const verifier  = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state     = randomBytes(16).toString('base64url')
    openAIPkceStore.set(state, { verifier, createdAt: Date.now() })
    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     OPENAI_CLIENT_ID,
      redirect_uri:  OPENAI_REDIRECT_URI,
      scope:         OPENAI_SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    })
    return { url: `${OPENAI_AUTH_URL}?${params}`, state }
  })

  app.post('/api/auth/openai/exchange', async (req, reply) => {
    const { code, state } = req.body as { code: string; state: string }
    const stored = state ? openAIPkceStore.get(state) : null
    if (!stored) return reply.status(400).send({ ok: false, message: 'State expired — restart auth flow' })
    openAIPkceStore.delete(state)
    try {
      const tokenRes = await fetch(OPENAI_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          client_id:     OPENAI_CLIENT_ID,
          code,
          redirect_uri:  OPENAI_REDIRECT_URI,
          code_verifier: stored.verifier,
        }),
      })
      if (!tokenRes.ok) {
        const err = await tokenRes.text()
        return reply.status(tokenRes.status).send({ ok: false, message: err })
      }
      const data = await tokenRes.json() as {
        access_token: string; refresh_token?: string; expires_in?: number
      }
      persistEnvKey('OPENAI_ACCESS_TOKEN',  data.access_token)
      if (data.refresh_token) persistEnvKey('OPENAI_REFRESH_TOKEN', data.refresh_token)
      if (data.expires_in)    persistEnvKey('OPENAI_TOKEN_EXPIRES', String(Date.now() + data.expires_in * 1000))
      return { ok: true }
    } catch (e) {
      return reply.status(500).send({ ok: false, message: String(e) })
    }
  })

  app.post('/api/auth/openai/refresh', async (_req, reply) => {
    const refreshToken = process.env.OPENAI_REFRESH_TOKEN
    if (!refreshToken) return reply.status(400).send({ ok: false, message: 'No refresh token stored' })
    try {
      const { refreshOpenAIToken } = await import('../llm/openai-subscription.js')
      const data = await refreshOpenAIToken(refreshToken)
      persistEnvKey('OPENAI_ACCESS_TOKEN',  data.access_token)
      if (data.refresh_token) persistEnvKey('OPENAI_REFRESH_TOKEN', data.refresh_token)
      if (data.expires_in)    persistEnvKey('OPENAI_TOKEN_EXPIRES', String(Date.now() + data.expires_in * 1000))
      return { ok: true }
    } catch (e) {
      return reply.status(500).send({ ok: false, message: String(e) })
    }
  })

  // ── Calendar ──────────────────────────────────────────────────────────────────

  app.get('/api/calendar', async () => {
    return fetchCalendarForDisplay()
  })

  // ── Symbol summary (bias heatmap data) ───────────────────────────────────────

  app.get('/api/summary', async () => {
    const symbols   = dbGetAllSymbols()
    const scheduled = new Set(getScheduledKeys())

    return symbols.map(sym => {
      const latest = dbGetLatestAnalysis(sym.key)
      return {
        key:            sym.key,
        symbol:         sym.symbol,
        displayName:    sym.displayName,
        scheduleEnabled: sym.scheduleEnabled,
        scheduled:      scheduled.has(sym.key),
        running:        isAnalysisRunning(sym.key),
        lastAnalysisAt: sym.lastAnalysisAt ?? null,
        bias:           latest?.bias ?? null,
        summary:        latest?.summary ? latest.summary.slice(0, 120) : null,
        error:          latest?.error ?? null,
        direction:      latest?.tradeProposal?.direction ?? null,
        confidence:     latest?.tradeProposal?.confidence ?? null,
        riskReward:     latest?.tradeProposal?.riskReward ?? null,
        validationScore: latest?.validation?.score ?? null,
      }
    })
  })

  // ── Outcome tracking ──────────────────────────────────────────────────────────

  app.get('/api/outcomes', async (req) => {
    const { symbolKey, limit } = req.query as { symbolKey?: string; limit?: string }
    return dbGetOutcomes(symbolKey, limit ? parseInt(limit) : 100)
  })

  app.get('/api/outcomes/stats', async (req) => {
    const { symbolKey } = req.query as { symbolKey?: string }
    return dbGetOutcomeStats(symbolKey)
  })

  app.get('/api/outcomes/pending', async () => {
    return dbGetPendingOutcomes()
  })

  // ── Dashboard status ──────────────────────────────────────────────────────────

  app.get('/api/status', async () => {
    const symbols = dbGetAllSymbols()
    const recentAnalyses = dbGetAllRecentAnalyses(20)
    return {
      symbols,
      recentAnalyses,
      scheduled: getScheduledKeys(),
    }
  })

  // ── Selected account persistence ─────────────────────────────────────────────

  app.get('/api/selected-account', async () => {
    const v = dbGetSetting('selected_account')
    if (!v) return null
    try { return JSON.parse(v) } catch { return null }
  })

  app.post('/api/selected-account', async (req) => {
    const body = req.body as Record<string, unknown> | null
    dbSetSetting('selected_account', body ? JSON.stringify(body) : '')
    return { ok: true }
  })

  // ── General app config (bridge, runtime) ─────────────────────────────────────

  app.get('/api/config', async () => {
    return {
      bridgePort:   process.env.MT5_BRIDGE_PORT   ?? '8000',
      bridgeUrl:    process.env.MT5_BRIDGE_URL     ?? '',
      bridgeKeySet: !!(process.env.MT5_BRIDGE_KEY?.trim()),
      logLevel:     process.env.LOG_LEVEL           ?? 'info',
    }
  })

  app.post('/api/config', async (req) => {
    const body = req.body as { bridgePort?: string; bridgeUrl?: string; bridgeKey?: string; logLevel?: string }
    if (body.bridgePort != null) {
      persistEnvKey('MT5_BRIDGE_PORT', body.bridgePort)
      process.env.MT5_BRIDGE_PORT = body.bridgePort
    }
    if (body.bridgeUrl != null) {
      persistEnvKey('MT5_BRIDGE_URL', body.bridgeUrl)
      process.env.MT5_BRIDGE_URL = body.bridgeUrl
    }
    if (body.bridgeKey != null && body.bridgeKey.trim()) {
      persistEnvKey('MT5_BRIDGE_KEY', body.bridgeKey.trim())
      process.env.MT5_BRIDGE_KEY = body.bridgeKey.trim()
    }
    if (body.logLevel != null) {
      const validLevels = ['debug', 'info', 'warn', 'error']
      if (validLevels.includes(body.logLevel)) {
        persistEnvKey('LOG_LEVEL', body.logLevel)
        process.env.LOG_LEVEL = body.logLevel
      }
    }
    return { ok: true }
  })

  // ── Phase 2: Feature & market-state snapshots ────────────────────────────────

  app.get('/api/symbols/:key/features/latest', async (req, reply) => {
    const { key } = req.params as { key: string }
    if (!dbGetSymbol(key)) return reply.status(404).send({ error: 'Symbol not found' })
    const features = dbGetLatestFeatures(key)
    if (!features) return reply.status(404).send({ error: 'No feature snapshot yet' })
    return features
  })

  app.get('/api/symbols/:key/state/latest', async (req, reply) => {
    const { key } = req.params as { key: string }
    if (!dbGetSymbol(key)) return reply.status(404).send({ error: 'Symbol not found' })
    const state = dbGetLatestMarketState(key)
    if (!state) return reply.status(404).send({ error: 'No market state yet' })
    return state
  })

  app.get('/api/symbols/:key/setups/latest', async (req, reply) => {
    const { key } = req.params as { key: string }
    if (!dbGetSymbol(key)) return reply.status(404).send({ error: 'Symbol not found' })
    return dbGetLatestCandidates(key)
  })

  // ── Phase 3: Strategy versioning ─────────────────────────────────────────────

  app.get('/api/strategies/:key/versions', async (req, reply) => {
    const { key } = req.params as { key: string }
    return reply.send(dbGetStrategyVersions(key))
  })

  // ── Phase 4: Backtesting ──────────────────────────────────────────────────────

  app.post('/api/backtests', async (req, reply) => {
    const body = req.body as {
      symbolKey?: string
      strategyKey?: string
      timeframe?: string
      count?: number
    }
    if (!body.symbolKey) return reply.status(400).send({ error: 'symbolKey is required' })

    const sym = dbGetSymbol(body.symbolKey)
    if (!sym) return reply.status(404).send({ error: 'Symbol not found' })

    const config = {
      timeframe:   body.timeframe   ?? sym.candleConfig?.primaryTimeframe ?? 'h1',
      count:       body.count       ?? 300,
      strategyKey: body.strategyKey ?? sym.strategy ?? '',
    }

    const runId = dbCreateBacktestRun(body.symbolKey, config)

    // Run async — fetch candles from MT5, then replay
    ;(async () => {
      try {
        const { runBacktest } = await import('../backtest/engine.js')
        const { resolveStrategyDefinition } = await import('../strategies/resolver.js')

        const TF_MAP: Record<string, string> = {
          m1: 'M1', m5: 'M5', m15: 'M15', m30: 'M30', h1: 'H1', h4: 'H4',
        }
        const bridgeTf = TF_MAP[config.timeframe] ?? 'H1'
        const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`
        const hdrs = process.env.MT5_BRIDGE_KEY ? { 'X-Bridge-Key': process.env.MT5_BRIDGE_KEY } : {}

        const r = await fetch(
          `${base}/candles/${encodeURIComponent(sym.symbol)}?timeframe=${bridgeTf}&count=${config.count}`,
          { headers: hdrs },
        )
        if (!r.ok) throw new Error(`Bridge returned ${r.status}`)

        const raw = await r.json() as { candles: Array<{ openTime: number; open: number; high: number; low: number; close: number; volume: number }> }
        const candles = (raw.candles ?? []).map(c => ({
          openTime:  c.openTime,
          open:      c.open,
          high:      c.high,
          low:       c.low,
          close:     c.close,
          volume:    c.volume,
          closeTime: c.openTime + 3599000,  // approximate 1h close
        }))

        const strategy = config.strategyKey ? (resolveStrategyDefinition(config.strategyKey) ?? undefined) : undefined
        const fullConfig = {
          ...config,
          symbolKey: body.symbolKey!,
          symbol:    sym.symbol,
          fromDate:  candles.length > 0 ? new Date(candles[0].openTime).toISOString() : new Date().toISOString(),
          toDate:    candles.length > 0 ? new Date(candles[candles.length - 1].openTime).toISOString() : new Date().toISOString(),
        }
        const result = runBacktest({ config: fullConfig, candles, strategy, runId })

        dbSaveBacktestTrades(result.trades)
        dbCompleteBacktestRun(runId, result.metrics)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        dbFailBacktestRun(runId, msg)
      }
    })()

    return reply.status(202).send({ ok: true, runId })
  })

  app.get('/api/backtests/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const run = dbGetBacktestRun(parseInt(id))
    if (!run) return reply.status(404).send({ error: 'Backtest run not found' })
    return run
  })

  // ── Phase 5: Research endpoints ───────────────────────────────────────────────

  app.get('/api/research/leaderboard', async (req) => {
    const { symbolKey } = req.query as { symbolKey?: string }
    const { leaderboardByDetector, leaderboardBySession, leaderboardByRegime } = await import('../research/aggregates.js')

    const symbols = symbolKey ? [dbGetSymbol(symbolKey)].filter(Boolean) : dbGetAllSymbols()
    const allCandidates = symbols.flatMap(s => s ? dbGetLatestCandidates(s.key) : [])

    return {
      byDetector: leaderboardByDetector(allCandidates),
      bySession:  leaderboardBySession(allCandidates),
      byRegime:   leaderboardByRegime(allCandidates),
    }
  })

  app.get('/api/research/similar/:analysisId', async (req, reply) => {
    const { analysisId } = req.params as { analysisId: string }
    const id = parseInt(analysisId)

    const current = dbGetFeaturesForAnalysis(id)
    if (!current) return reply.status(404).send({ error: 'No features for this analysis' })

    const analysis = dbGetAnalysisById(id)
    if (!analysis) return reply.status(404).send({ error: 'Analysis not found' })

    const { findSimilarAnalyses } = await import('../research/similarity.js')
    const historyEntries = dbGetLatestFeatureHistory(analysis.symbolKey, 200)

    const history = historyEntries
      .map(h => {
        const f = dbGetFeaturesForAnalysis(h.analysisId)
        if (!f) return null
        return { analysisId: h.analysisId, symbolKey: analysis.symbolKey, capturedAt: h.capturedAt, features: f }
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)

    return findSimilarAnalyses(current, history)
  })

  // ── Phase 5: Alert rules ──────────────────────────────────────────────────────

  app.post('/api/alerts', async (req, reply) => {
    const body = req.body as {
      symbolKey?: string
      name?: string
      conditionType?: string
      conditionValue?: string
      enabled?: boolean
    }
    if (!body.symbolKey || !body.name || !body.conditionType || body.conditionValue == null) {
      return reply.status(400).send({ error: 'symbolKey, name, conditionType and conditionValue are required' })
    }
    const validTypes = ['setup_score_gte', 'regime_change', 'direction_change', 'context_risk_gte']
    if (!validTypes.includes(body.conditionType)) {
      return reply.status(400).send({ error: `conditionType must be one of: ${validTypes.join(', ')}` })
    }
    const id = dbCreateAlertRule({
      symbolKey:      body.symbolKey,
      name:           body.name,
      conditionType:  body.conditionType as 'setup_score_gte' | 'regime_change' | 'direction_change' | 'context_risk_gte',
      conditionValue: body.conditionValue,
      enabled:        body.enabled ?? true,
    })
    return reply.status(201).send({ ok: true, id })
  })

  app.get('/api/alerts', async (req) => {
    const { symbolKey } = req.query as { symbolKey?: string }
    return dbGetAlertRules(symbolKey)
  })

  app.patch('/api/alerts/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { enabled } = req.body as { enabled?: boolean }
    if (enabled == null) return reply.status(400).send({ error: 'enabled field required' })
    dbToggleAlertRule(parseInt(id), enabled)
    return { ok: true }
  })

  app.delete('/api/alerts/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    dbDeleteAlertRule(parseInt(id))
    return reply.send({ ok: true })
  })

  app.get('/api/alerts/firings', async (req) => {
    const { symbolKey, limit } = req.query as { symbolKey?: string; limit?: string }
    return dbGetAlertFirings(symbolKey, limit ? parseInt(limit) : 50)
  })

  app.post('/api/alerts/firings/:id/acknowledge', async (req, reply) => {
    const { id } = req.params as { id: string }
    dbAcknowledgeAlert(parseInt(id))
    return reply.send({ ok: true })
  })

  // ── Phase 6: Deep health check ────────────────────────────────────────────────

  app.get('/api/system/health/deep', async (_req, reply) => {
    const checks: Record<string, { ok: boolean; message: string }> = {}

    // MT5 bridge
    checks.mt5 = await testConnection('mt5')

    // LLM provider
    const llmProvider = String(getPlatformLLMProvider())
    checks.llm = await testConnection(llmProvider)

    // Finnhub
    checks.finnhub = await testConnection('finnhub')

    // DB — simple read
    try {
      const count = dbGetAllSymbols().length
      checks.db = { ok: true, message: `${count} symbol(s) in watchlist` }
    } catch (e) {
      checks.db = { ok: false, message: String(e) }
    }

    const allOk = Object.values(checks).every(c => c.ok)
    return reply.status(allOk ? 200 : 207).send({ ok: allOk, checks })
  })

  // ── Serve React frontend ──────────────────────────────────────────────────────

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
  log.info({ port: PORT }, `Wolf-Fin server running at http://localhost:${PORT}`)

  // Prime MT5 bridge data on startup
  fetchMt5Entries().catch(() => { /* bridge may not be running yet */ })
}
