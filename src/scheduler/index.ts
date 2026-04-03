// Wolf-Fin Scheduler — per-symbol interval-based analysis trigger
//
// Each WatchSymbol with scheduleEnabled=true and a scheduleIntervalMs gets
// a repeating timer. On each tick the scheduler calls runAnalysis(symbolKey)
// if the current UTC time falls within the optional scheduleStartUtc/scheduleEndUtc window.

import pino from 'pino'
import { runAnalysis, isAnalysisRunning } from '../analyzer/index.js'
import { logEvent } from '../server/state.js'
import type { WatchSymbol } from '../types.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

interface ScheduleEntry {
  sym:    WatchSymbol
  timer:  ReturnType<typeof setInterval>
}

const schedules = new Map<string, ScheduleEntry>()

// ── Time-window helpers ───────────────────────────────────────────────────────

function isInWindow(startUtc?: string, endUtc?: string): boolean {
  if (!startUtc || !endUtc) return true  // no window restriction

  const [sh, sm] = startUtc.split(':').map(Number)
  const [eh, em] = endUtc.split(':').map(Number)
  const now = new Date()
  const nowMin   = now.getUTCHours() * 60 + now.getUTCMinutes()
  const startMin = (sh ?? 0) * 60 + (sm ?? 0)
  const endMin   = (eh ?? 0) * 60 + (em ?? 0)

  // Window can span midnight (e.g. 22:00 → 06:00) when end ≤ start
  const spansMidnight = endMin <= startMin
  return spansMidnight
    ? (nowMin >= startMin || nowMin < endMin)
    : (nowMin >= startMin && nowMin < endMin)
}

// ── Start / stop / sync ───────────────────────────────────────────────────────

export function startSchedule(sym: WatchSymbol): void {
  if (!sym.scheduleEnabled || !sym.scheduleIntervalMs) return

  // Stop any existing schedule for this key first
  stopSchedule(sym.key)

  const intervalMs = Math.max(sym.scheduleIntervalMs, 60_000)  // minimum 1 minute

  const timer = setInterval(async () => {
    if (!isInWindow(sym.scheduleStartUtc, sym.scheduleEndUtc)) {
      logEvent(sym.key, 'info', 'schedule_tick', `Skipping — outside schedule window (${sym.scheduleStartUtc}–${sym.scheduleEndUtc} UTC)`)
      return
    }
    if (isAnalysisRunning(sym.key)) {
      logEvent(sym.key, 'info', 'schedule_tick', 'Skipping — analysis already in progress')
      return
    }
    logEvent(sym.key, 'info', 'schedule_tick', `Scheduled analysis triggered (interval: ${intervalMs / 60000}min)`)
    runAnalysis(sym.key).catch(err => {
      log.error({ symbolKey: sym.key, err }, 'scheduled analysis failed')
    })
  }, intervalMs)

  schedules.set(sym.key, { sym, timer })
  logEvent(sym.key, 'info', 'schedule_start', `Schedule started (every ${intervalMs / 60000}min)`)
  log.info({ symbolKey: sym.key, intervalMs }, 'schedule started')
}

export function stopSchedule(symbolKey: string): void {
  const entry = schedules.get(symbolKey)
  if (!entry) return
  clearInterval(entry.timer)
  schedules.delete(symbolKey)
  logEvent(symbolKey, 'info', 'schedule_stop', 'Schedule stopped')
  log.info({ symbolKey }, 'schedule stopped')
}

/**
 * Sync a symbol's schedule with the current config.
 * Call after adding, updating, or removing a symbol.
 */
export function syncSchedule(sym: WatchSymbol): void {
  if (sym.scheduleEnabled && sym.scheduleIntervalMs) {
    startSchedule(sym)
  } else {
    stopSchedule(sym.key)
  }
}

/** Stop all running schedules (called on server shutdown). */
export function stopAllSchedules(): void {
  for (const key of schedules.keys()) {
    stopSchedule(key)
  }
}

/** Return the keys of all currently scheduled symbols. */
export function getScheduledKeys(): string[] {
  return [...schedules.keys()]
}
