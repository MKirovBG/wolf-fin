// Wolf-Fin — entry point

import 'dotenv/config'
import pino from 'pino'
import { startServer } from './server/index.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

await startServer()

log.info('Wolf-Fin server started — no agents running. Configure and start agents from the dashboard.')
