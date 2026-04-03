// Wolf-Fin — shared in-memory state

import type { LogEntry, LogLevel, LogEvent } from '../types.js'
import { dbLogEvent, dbGetLogs, dbGetMaxLogId } from '../db/index.js'

// ── Log buffer ────────────────────────────────────────────────────────────────

// Lazy-init from DB max ID to prevent duplicate IDs on restart
let logSeq = -1
function nextLogId(): number {
  if (logSeq === -1) logSeq = dbGetMaxLogId()
  return ++logSeq
}
const logBuffer: LogEntry[] = []

// ── SSE subscribers ───────────────────────────────────────────────────────────

type LogSubscriber = (entry: LogEntry) => void
const logSubscribers = new Set<LogSubscriber>()

export function subscribeToLogs(cb: LogSubscriber): () => void {
  logSubscribers.add(cb)
  return () => logSubscribers.delete(cb)
}

// ── Analysis update events (broadcast when a new analysis completes) ──────────

export interface AnalysisEvent {
  type: 'analysis_update'
  symbolKey: string
  analysisId: number
}

type AnalysisSubscriber = (event: AnalysisEvent) => void
const analysisSubscribers = new Set<AnalysisSubscriber>()

export function subscribeToAnalyses(cb: AnalysisSubscriber): () => void {
  analysisSubscribers.add(cb)
  return () => analysisSubscribers.delete(cb)
}

export function broadcastAnalysisUpdate(symbolKey: string, analysisId: number): void {
  const event: AnalysisEvent = { type: 'analysis_update', symbolKey, analysisId }
  for (const sub of analysisSubscribers) {
    try { sub(event) } catch { /* ignore */ }
  }
}

// ── Log events ────────────────────────────────────────────────────────────────

export function logEvent(
  symbolKey: string,
  level: LogLevel,
  event: LogEvent,
  message: string,
  data?: Record<string, unknown>,
): void {
  const entry: LogEntry = {
    id: nextLogId(),
    time: new Date().toISOString(),
    symbolKey,
    level,
    event,
    message,
    data,
  }
  logBuffer.unshift(entry)
  if (logBuffer.length > 500) logBuffer.length = 500
  dbLogEvent(entry)
  for (const sub of logSubscribers) {
    try { sub(entry) } catch { /* ignore */ }
  }
}

export function getLogs(sinceId?: number, symbolKey?: string, limit = 200): LogEntry[] {
  return dbGetLogs(sinceId, symbolKey, limit)
}
