// Wolf-Fin Scheduler — cron-based cycle runner for each market

import cron from 'node-cron'
import pino from 'pino'
import { runAgentCycle, type AgentConfig } from '../agent/index.js'
import { isForexSessionOpen } from '../adapters/session.js'
import { setState } from '../server/state.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// Crypto: every 15 minutes on the clock
const CRYPTO_SCHEDULE = '*/15 * * * *'

// Forex: every 15 minutes — session guard runs inside the task
const FOREX_SCHEDULE = '*/15 * * * *'

const activeTasks: cron.ScheduledTask[] = []
let savedConfigs: AgentConfig[] = []

export function startScheduler(configs: AgentConfig[]): void {
  savedConfigs = configs

  for (const config of configs) {
    const schedule = config.market === 'crypto' ? CRYPTO_SCHEDULE : FOREX_SCHEDULE

    const task = cron.schedule(schedule, async () => {
      if (config.market === 'forex' && !isForexSessionOpen()) {
        log.debug({ symbol: config.symbol }, 'forex market closed — skipping cycle')
        return
      }

      try {
        await runAgentCycle(config)
      } catch (err) {
        log.error({ symbol: config.symbol, market: config.market, err }, 'agent cycle error')
      }
    })

    activeTasks.push(task)
    log.info({ symbol: config.symbol, market: config.market, schedule }, 'scheduler registered')
  }

  setState({ status: 'running', paused: false })
  log.info({ count: configs.length }, 'scheduler started')
}

export function pauseScheduler(): void {
  for (const task of activeTasks) task.stop()
  activeTasks.length = 0
  setState({ status: 'paused', paused: true })
  log.info('scheduler paused')
}

export function resumeScheduler(): void {
  if (savedConfigs.length === 0) return
  startScheduler(savedConfigs)
  log.info('scheduler resumed')
}

export function stopScheduler(): void {
  for (const task of activeTasks) task.stop()
  activeTasks.length = 0
  setState({ status: 'idle', paused: false })
  log.info('scheduler stopped')
}
