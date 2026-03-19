// Wolf-Fin Scheduler — per-agent continuous loop task management
//
// Fetch modes:
//   manual     — Start marks agent as running; each Trigger fires one single tick.
//   autonomous — Start begins a continuous loop: tick → await completion → tick → …
//   scheduled  — Same as autonomous; scheduled time defines the active window (future).
//
// The loop runs tick-to-tick with no fixed interval between ticks.
// This eliminates overlap, duplicate-trigger skips, and setInterval drift.
// Trigger always fires one immediate out-of-schedule tick regardless of mode.

import pino from 'pino'
import { runAgentTick } from '../agent/index.js'
import { setAgentStatus } from '../server/state.js'
import { makeAgentKey } from '../db/index.js'
import type { AgentConfig } from '../types.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

interface LoopSignal { cancelled: boolean }

// Map of agentKey → abort signal for the running loop
const tasks = new Map<string, LoopSignal>()

function agentKey(config: AgentConfig): string {
  return makeAgentKey(config.market, config.symbol, config.mt5AccountId, config.name)
}

export function startAgentSchedule(config: AgentConfig): void {
  const key = agentKey(config)

  // Cancel any existing loop first (idempotent restart)
  const existing = tasks.get(key)
  if (existing) {
    existing.cancelled = true
    tasks.delete(key)
  }

  setAgentStatus(key, 'running')

  // Manual mode: just mark as running — each Trigger button press fires one tick
  if (config.fetchMode === 'manual') {
    log.info({ key }, 'agent registered in manual mode — awaiting Trigger')
    return
  }

  const signal: LoopSignal = { cancelled: false }
  tasks.set(key, signal)

  // Continuous loop: each tick awaits completion before the next begins.
  // No setInterval — no overlap, no drift, no duplicate-trigger skips.
  ;(async () => {
    log.info({ key, mode: config.fetchMode }, 'agent continuous loop started')
    while (!signal.cancelled) {
      try {
        await runAgentTick(config)
      } catch (err) {
        log.error({ key, err }, 'agent cycle error')
      }
    }
    log.info({ key }, 'agent loop stopped')
  })()
}

export function pauseAgentSchedule(key: string): void {
  const signal = tasks.get(key)
  if (signal) {
    signal.cancelled = true
    tasks.delete(key)
  }
  setAgentStatus(key, 'paused')
  log.info({ key }, 'agent schedule paused')
}

export function stopAgentSchedule(key: string): void {
  const signal = tasks.get(key)
  if (signal) {
    signal.cancelled = true
    tasks.delete(key)
  }
  setAgentStatus(key, 'idle')
  log.info({ key }, 'agent schedule stopped')
}

export function resumeAgentSchedule(config: AgentConfig): void {
  startAgentSchedule(config)
}

export function stopAllSchedules(): void {
  for (const [key, signal] of tasks) {
    signal.cancelled = true
    setAgentStatus(key, 'idle')
  }
  tasks.clear()
  log.info('all agent schedules stopped')
}
