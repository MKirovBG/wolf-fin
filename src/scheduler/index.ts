// Wolf-Fin Scheduler — per-agent continuous loop task management
//
// Fetch modes:
//   manual     — Start marks agent as running; each Trigger fires one single tick.
//   autonomous — Start begins a continuous loop: tick → await completion → tick → …
//   scheduled  — Same as autonomous; scheduled time defines the active window.
//                If scheduledStartUtc / scheduledEndUtc are set the loop sleeps
//                outside that window and resumes when it opens.
//
// The loop runs tick-to-tick with no fixed interval between ticks.
// Trigger always fires one immediate out-of-schedule tick regardless of mode.

import pino from 'pino'
import { runAgentTick } from '../agent/index.js'
import { setAgentStatus, getAgent } from '../server/state.js'
import { makeAgentKey } from '../db/index.js'
import type { AgentConfig } from '../types.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

interface LoopSignal { cancelled: boolean }

// Map of agentKey → abort signal for the running loop
const tasks = new Map<string, LoopSignal>()

// Map of agentKey → consecutive HOLD count for throttle backoff
const consecutiveHolds = new Map<string, number>()

/** Delay (ms) based on how many consecutive HOLDs the agent has produced. */
function holdBackoffMs(holds: number): number {
  if (holds <= 3)  return 0       // first few — market may shift quickly
  if (holds <= 10) return 30_000  // 30 s
  if (holds <= 20) return 60_000  // 1 min
  return 120_000                  // 2 min cap
}

function agentKey(config: AgentConfig): string {
  return makeAgentKey(config.market, config.symbol, config.mt5AccountId, config.name)
}

// ── Scheduled time-window helpers ─────────────────────────────────────────────

/** Returns milliseconds until the scheduled window opens (0 if currently inside). */
function msUntilWindowOpen(startUtc: string, endUtc: string): number {
  const [sh, sm] = startUtc.split(':').map(Number)
  const [eh, em] = endUtc.split(':').map(Number)
  const now = new Date()
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes()
  const startMin = (sh ?? 0) * 60 + (sm ?? 0)
  const endMin   = (eh ?? 0) * 60 + (em ?? 0)

  // Window spans midnight (e.g. 22:00 → 06:00) when end ≤ start
  const spansMidnight = endMin <= startMin
  const inWindow = spansMidnight
    ? (nowMin >= startMin || nowMin < endMin)
    : (nowMin >= startMin && nowMin < endMin)

  if (inWindow) return 0

  // Minutes until next window open
  let minsUntil: number
  if (spansMidnight) {
    minsUntil = nowMin < startMin ? startMin - nowMin : 24 * 60 - nowMin + startMin
  } else {
    minsUntil = nowMin < startMin ? startMin - nowMin : 24 * 60 - nowMin + startMin
  }
  return minsUntil * 60 * 1000
}

/** Sleep in short chunks so signal.cancelled can stop the wait early. */
async function sleepCancellable(ms: number, signal: LoopSignal): Promise<void> {
  const chunk = 30_000
  let remaining = ms
  while (remaining > 0 && !signal.cancelled) {
    await new Promise(resolve => setTimeout(resolve, Math.min(remaining, chunk)))
    remaining -= chunk
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

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

      // ── Scheduled window gate ────────────────────────────────────────────
      if (config.scheduledStartUtc && config.scheduledEndUtc) {
        const delayMs = msUntilWindowOpen(config.scheduledStartUtc, config.scheduledEndUtc)
        if (delayMs > 0) {
          const mins = Math.round(delayMs / 60_000)
          log.info({ key, delayMs }, `outside scheduled window — sleeping ${mins}m`)
          await sleepCancellable(delayMs, signal)
          continue
        }
      }

      try {
        await runAgentTick(config)
      } catch (err) {
        log.error({ key, err }, 'agent cycle error')
      }

      // ── Guardrail auto-pause detection ───────────────────────────────────
      // If a guardrail (daily loss, drawdown) paused the agent from inside a tick,
      // honour it by stopping the loop — without needing a circular import.
      if (!signal.cancelled) {
        const state = getAgent(key)
        if (state?.status === 'paused') {
          signal.cancelled = true
          tasks.delete(key)
          log.info({ key }, 'loop stopped — agent was paused by a guardrail')
          continue
        }

        // ── Hold-throttle backoff ──────────────────────────────────────────
        // When the agent keeps HOLDing, slow down to save API calls.
        const decision = state?.lastCycle?.decision ?? ''
        if (/^(HOLD|\[HOLD)/.test(decision)) {
          const holds = (consecutiveHolds.get(key) ?? 0) + 1
          consecutiveHolds.set(key, holds)
          const delay = holdBackoffMs(holds)
          if (delay > 0) {
            log.info({ key, holds, delaySec: delay / 1000 }, 'hold-throttle — backing off')
            await sleepCancellable(delay, signal)
          }
        } else {
          consecutiveHolds.set(key, 0)
        }
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
  consecutiveHolds.delete(key)
  setAgentStatus(key, 'paused')
  log.info({ key }, 'agent schedule paused')
}

export function stopAgentSchedule(key: string): void {
  const signal = tasks.get(key)
  if (signal) {
    signal.cancelled = true
    tasks.delete(key)
  }
  consecutiveHolds.delete(key)
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
  consecutiveHolds.clear()
  log.info('all agent schedules stopped')
}
