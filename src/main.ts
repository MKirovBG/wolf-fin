// Wolf-Fin — entry point

import 'dotenv/config'
import pino from 'pino'
import { initDb, dbGetAllAgents } from './db/index.js'
import { upsertAgent } from './server/state.js'
import { startServer } from './server/index.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

initDb()

const savedAgents = dbGetAllAgents()
for (const agent of savedAgents) {
  // Reset runtime state: running → idle, clear startedAt
  upsertAgent({ ...agent, status: 'idle', startedAt: null })
}
if (savedAgents.length > 0) {
  log.info({ count: savedAgents.length }, 'Restored agents from database')
}

await startServer()

log.info('Wolf-Fin server started — configure and start agents from the dashboard.')
