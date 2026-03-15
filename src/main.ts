// Wolf-Fin — main entry point

import 'dotenv/config'
import pino from 'pino'
import { startScheduler } from './scheduler/index.js'
import { startServer } from './server/index.js'
import { setState } from './server/state.js'
import type { AgentConfig } from './agent/index.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

const paperMode = process.env.PAPER_TRADING !== 'false'

const configs: AgentConfig[] = [
  { symbol: process.env.CRYPTO_SYMBOL ?? 'BTCUSDT', market: 'crypto', paper: paperMode },
  // Forex only when OANDA keys are present
  ...(process.env.OANDA_API_KEY && process.env.OANDA_ACCOUNT_ID
    ? [{ symbol: process.env.FOREX_SYMBOL ?? 'EUR_USD', market: 'forex' as const, paper: paperMode }]
    : []),
]

setState({
  configs,
  paperMode,
  startedAt: new Date().toISOString(),
})

startScheduler(configs)

await startServer()

log.info(
  { paperMode, symbols: configs.map(c => `${c.symbol}(${c.market})`).join(', ') },
  paperMode
    ? '[PAPER TRADING — no real orders will be sent]'
    : '[LIVE TRADING — real orders active]',
)
