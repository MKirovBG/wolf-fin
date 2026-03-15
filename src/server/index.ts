// Wolf-Fin — HTTP dashboard server

import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'fs'
import pino from 'pino'
import { getState, setState } from './state.js'
import { getRiskState, MAX_DAILY_LOSS_USD } from '../guardrails/riskState.js'
import { getRiskStateFor } from '../guardrails/riskStateStore.js'
import { pauseScheduler, resumeScheduler, startScheduler } from '../scheduler/index.js'
import { runAgentCycle } from '../agent/index.js'
import type { AgentConfig } from '../agent/index.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })
const PORT = parseInt(process.env.PORT ?? '3000', 10)
const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Helpers ────────────────────────────────────────────────────────────────────

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'CLAUDE_MODEL',
  'OANDA_API_KEY', 'OANDA_ACCOUNT_ID',
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
      case 'oanda': {
        const base = process.env.OANDA_PAPER !== 'false' ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com'
        const r = await fetch(`${base}/v3/accounts`, {
          headers: { Authorization: `Bearer ${process.env.OANDA_API_KEY ?? ''}` },
        })
        return r.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `HTTP ${r.status}` }
      }
      case 'binance': {
        const r = await fetch('https://testnet.binance.vision/api/v3/ping')
        return r.ok ? { ok: true, message: 'Ping OK' } : { ok: false, message: `HTTP ${r.status}` }
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

// ── Server ─────────────────────────────────────────────────────────────────────

export async function startServer(): Promise<void> {
  const app = Fastify({ logger: false })

  // ── Status ──────────────────────────────────────────────────────────────────
  app.get('/api/status', async () => {
    return { ...getState(), risk: getRiskState(), maxDailyLossUsd: MAX_DAILY_LOSS_USD }
  })

  app.post('/api/pause', async () => {
    pauseScheduler()
    return { ok: true }
  })

  app.post('/api/resume', async () => {
    resumeScheduler()
    return { ok: true }
  })

  // ── Agents ──────────────────────────────────────────────────────────────────
  app.get('/api/agents', async () => {
    return getState().configs
  })

  app.post('/api/agents', async (req) => {
    const body = req.body as AgentConfig
    const current = getState().configs
    const key = `${body.market}:${body.symbol}`
    if (current.some(c => `${c.market}:${c.symbol}` === key)) {
      return { ok: false, message: 'Agent already exists' }
    }
    const updated = [...current, body]
    setState({ configs: updated })
    pauseScheduler()
    startScheduler(updated)
    return { ok: true }
  })

  app.delete('/api/agents/:key', async (req) => {
    const { key } = req.params as { key: string }
    const [market, symbol] = key.split(':')
    const updated = getState().configs.filter(c => !(c.market === market && c.symbol === symbol))
    setState({ configs: updated })
    pauseScheduler()
    if (updated.length > 0) startScheduler(updated)
    return { ok: true }
  })

  app.post('/api/agents/:key/trigger', async (req) => {
    const { key } = req.params as { key: string }
    const [market, symbol] = key.split(':')
    const config = getState().configs.find(c => c.market === market && c.symbol === symbol)
    if (!config) return { ok: false, message: 'Agent not found' }
    runAgentCycle(config).catch(err => log.error({ err }, 'manual trigger error'))
    return { ok: true }
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
    // SPA fallback — all non-API routes return index.html
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html')
    })
  } else {
    // Dev mode — redirect to Vite dev server hint
    app.get('/', async (_req, reply) => {
      reply.type('text/html').send(`
        <html><body style="background:#0d0d0d;color:#e0e0e0;font-family:monospace;padding:40px">
          <h2 style="color:#00e676">Wolf-Fin API running</h2>
          <p>Frontend not built. Run <code>cd frontend && pnpm dev</code> then open <a style="color:#00e676" href="http://localhost:5173">localhost:5173</a></p>
          <p>API available at <a style="color:#00e676" href="/api/status">/api/status</a></p>
        </body></html>
      `)
    })
  }

  await app.listen({ port: PORT, host: '0.0.0.0' })
  log.info({ port: PORT }, `server running at http://localhost:${PORT}`)
}
