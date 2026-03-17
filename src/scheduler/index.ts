// Wolf-Fin Scheduler — per-agent interval task management
// Uses setInterval so any granularity is supported (2s → 4h).
// If a cycle is still running when the next tick fires, the tick is
// skipped — the cycle-lock in runAgentCycle handles this automatically.

import pino from 'pino'
import { runAgentCycle } from '../agent/index.js'
import { isForexSessionOpen } from '../adapters/session.js'
import { setAgentStatus } from '../server/state.js'
import type { AgentConfig } from '../types.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// Map of agentKey → active interval handle
const tasks = new Map<string, ReturnType<typeof setInterval>>()

function agentKey(config: AgentConfig): string {
  return `${config.market}:${config.symbol}`
}

/** Backwards-compat: old DB records stored scheduleIntervalMinutes (number in minutes).
 *  New records store scheduleIntervalSeconds. */
function resolveIntervalMs(config: AgentConfig): number {
  const cfg = config as AgentConfig & { scheduleIntervalMinutes?: number }
  if (cfg.scheduleIntervalSeconds != null) return cfg.scheduleIntervalSeconds * 1000
  if (cfg.scheduleIntervalMinutes != null) return cfg.scheduleIntervalMinutes * 60 * 1000
  return 60_000 // fallback: 1 minute
}

export function startAgentSchedule(config: AgentConfig): void {
  const key = agentKey(config)

  // Stop any existing task first (idempotent)
  const existing = tasks.get(key)
  if (existing) {
    clearInterval(existing)
    tasks.delete(key)
  }

  // In manual mode just mark running — user triggers cycles via button
  if (config.fetchMode === 'manual') {
    setAgentStatus(key, 'running')
    log.info({ key }, 'agent registered in manual mode')
    return
  }

  const intervalMs = resolveIntervalMs(config)

  const handle = setInterval(async () => {
    // Autonomous mode: skip if MT5 market is closed
    if (config.fetchMode === 'autonomous' && config.market === 'mt5' && !isForexSessionOpen()) {
      log.debug({ key }, 'autonomous — market closed, skipping')
      return
    }

    try {
      await runAgentCycle(config)
    } catch (err) {
      log.error({ key, err }, 'agent cycle error')
    }
  }, intervalMs)

  tasks.set(key, handle)
  setAgentStatus(key, 'running')
  log.info({ key, intervalMs, mode: config.fetchMode }, 'agent schedule started')
}

export function pauseAgentSchedule(key: string): void {
  const handle = tasks.get(key)
  if (handle) {
    clearInterval(handle)
    tasks.delete(key)
  }
  setAgentStatus(key, 'paused')
  log.info({ key }, 'agent schedule paused')
}

export function stopAgentSchedule(key: string): void {
  const handle = tasks.get(key)
  if (handle) {
    clearInterval(handle)
    tasks.delete(key)
  }
  setAgentStatus(key, 'idle')
  log.info({ key }, 'agent schedule stopped')
}

export function resumeAgentSchedule(config: AgentConfig): void {
  startAgentSchedule(config)
}

export function stopAllSchedules(): void {
  for (const [key, handle] of tasks) {
    clearInterval(handle)
    setAgentStatus(key, 'idle')
  }
  tasks.clear()
  log.info('all agent schedules stopped')
}
