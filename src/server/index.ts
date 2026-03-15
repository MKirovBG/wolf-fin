// Wolf-Fin — HTTP dashboard server

import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'fs'
import pino from 'pino'
import { getState, getAgent, upsertAgent, removeAgent, setAgentStatus } from './state.js'
import { getRiskState, MAX_DAILY_LOSS_USD } from '../guardrails/riskState.js'
import { getRiskStateFor } from '../guardrails/riskStateStore.js'
import { startAgentSchedule, pauseAgentSchedule, stopAgentSchedule } from '../scheduler/index.js'
import { runAgentCycle } from '../agent/index.js'
import { getAdapter } from '../adapters/registry.js'
import type { AgentConfig, AgentState } from '../types.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })
const PORT = parseInt(process.env.PORT ?? '3000', 10)
const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Helpers ────────────────────────────────────────────────────────────────────

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'CLAUDE_MODEL',
  'ALPACA_API_KEY', 'ALPACA_API_SECRET', 'ALPACA_PAPER_KEY', 'ALPACA_PAPER_SECRET',
  'BINANCE_API_KEY', 'BINANCE_API_SECRET',
  'FINNHUB_KEY', 'TWELVE_DATA_KEY', 'COINGECKO_KEY',
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
      case 'alpaca': {
        const paper = process.env.ALPACA_PAPER !== 'false'
        const base = paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'
        const key = paper ? process.env.ALPACA_PAPER_KEY : process.env.ALPACA_API_KEY
        const secret = paper ? process.env.ALPACA_PAPER_SECRET : process.env.ALPACA_API_SECRET
        const r = await fetch(`${base}/v2/account`, {
          headers: { 'APCA-API-KEY-ID': key ?? '', 'APCA-API-SECRET-KEY': secret ?? '' },
        })
        return r.ok ? { ok: true, message: paper ? 'Paper account OK' : 'Live account OK' } : { ok: false, message: `HTTP ${r.status}` }
      }
      case 'binance': {
        const testnet = process.env.BINANCE_TESTNET !== 'false'
        const base = testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com'
        const r = await fetch(`${base}/api/v3/ping`)
        return r.ok ? { ok: true, message: testnet ? 'Testnet ping OK' : 'Ping OK' } : { ok: false, message: `HTTP ${r.status}` }
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
        const r = await fetch('https://api.coingecko.com/api/v3/ping')
        return r.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `HTTP ${r.status}` }
      }
      default:
        return { ok: false, message: 'Unknown service' }
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Connection failed' }
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
      agents: Object.values(agents),
      recentEvents,
      risk: getRiskState(),
      maxDailyLossUsd: MAX_DAILY_LOSS_USD,
    }
  })

  // ── Agents ──────────────────────────────────────────────────────────────────

  app.get('/api/agents', async () => {
    return Object.values(getState().agents)
  })

  app.post('/api/agents', async (req) => {
    const body = req.body as AgentConfig
    const key = `${body.market}:${body.symbol}`
    if (getAgent(key)) return { ok: false, message: 'Agent already exists' }
    upsertAgent(defaultAgentState(body))
    return { ok: true, key }
  })

  app.delete('/api/agents/:key', async (req) => {
    const { key } = req.params as { key: string }
    stopAgentSchedule(key)
    removeAgent(key)
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
    runAgentCycle(agent.config).catch(err => log.error({ err, key }, 'manual trigger error'))
    return { ok: true }
  })

  // ── Market Data (read-only snapshot, no agent/Claude involved) ───────────────
  app.get('/api/market/:market/:symbol', async (req, reply) => {
    const { market, symbol } = req.params as { market: string; symbol: string }
    if (market !== 'crypto' && market !== 'forex') {
      return reply.status(400).send({ error: 'market must be crypto or forex' })
    }
    try {
      const adapter = getAdapter(market as 'crypto' | 'forex')
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
    const { recentEvents } = getState()
    const summary = (market: 'crypto' | 'forex') => {
      const events = recentEvents.filter(e => e.market === market)
      return {
        totalCycles: events.length,
        buys: events.filter(e => e.decision.toUpperCase().startsWith('BUY')).length,
        sells: events.filter(e => e.decision.toUpperCase().startsWith('SELL')).length,
        holds: events.filter(e => e.decision.toUpperCase().startsWith('HOLD')).length,
        errors: events.filter(e => e.error).length,
        risk: getRiskStateFor(market),
      }
    }
    return { crypto: summary('crypto'), forex: summary('forex') }
  })

  app.get('/api/reports/trades', async (req) => {
    const { market } = req.query as { market?: string }
    const { recentEvents } = getState()
    return market ? recentEvents.filter(e => e.market === market) : recentEvents
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
}
