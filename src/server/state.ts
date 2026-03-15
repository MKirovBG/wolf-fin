// Wolf-Fin — shared in-memory state (with SQLite persistence)

import type { AgentState, AgentStatus, CycleResult } from '../types.js'

// Re-export for modules that used to import CycleResult from here
export type { CycleResult } from '../types.js'
import type { LogEntry, LogLevel, LogEvent } from '../types.js'
import {
  dbUpsertAgent,
  dbRemoveAgent,
  dbUpdateAgentStatus,
  dbRecordCycle,
  dbLogEvent,
  dbGetLogs,
  dbGetMaxLogId,
} from '../db/index.js'

// ── Log buffer ────────────────────────────────────────────────────────────────

// Initialized lazily on first use so it reads from DB after initDb() has run
let logSeq = -1
function nextLogId(): number {
  if (logSeq === -1) logSeq = dbGetMaxLogId()
  return ++logSeq
}
const logBuffer: LogEntry[] = []

export function logEvent(
  agentKey: string,
  level: LogLevel,
  event: LogEvent,
  message: string,
  data?: Record<string, unknown>,
): void {
  const entry: LogEntry = { id: nextLogId(), time: new Date().toISOString(), agentKey, level, event, message, data }
  logBuffer.unshift(entry)
  if (logBuffer.length > 500) logBuffer.length = 500
  dbLogEvent(entry)
}

export function getLogs(sinceId?: number, agentKey?: string): LogEntry[] {
  // Serve from DB for full history; fall back to buffer for low-latency polling
  return dbGetLogs(sinceId, agentKey, 200)
}

interface AppState {
  agents: Record<string, AgentState>   // key = "market:symbol"
  recentEvents: CycleResult[]
}

const state: AppState = {
  agents: {},
  recentEvents: [],
}

export function getState(): Readonly<AppState> {
  return state
}

export function getAgent(key: string): AgentState | undefined {
  return state.agents[key]
}

export function upsertAgent(agent: AgentState): void {
  const key = `${agent.config.market}:${agent.config.symbol}`
  state.agents[key] = agent
  dbUpsertAgent(agent)
}

export function removeAgent(key: string): void {
  delete state.agents[key]
  dbRemoveAgent(key)
}

export function setAgentStatus(key: string, status: AgentStatus): void {
  const agent = state.agents[key]
  if (agent) {
    agent.status = status
    if (status === 'running' && !agent.startedAt) {
      agent.startedAt = new Date().toISOString()
    }
    if (status === 'idle') {
      agent.startedAt = null
    }
    dbUpdateAgentStatus(key, agent.status, agent.startedAt)
  }
}

export function recordCycle(key: string, result: CycleResult): void {
  const agent = state.agents[key]
  if (agent) {
    agent.lastCycle = result
    agent.cycleCount++
    dbUpsertAgent(agent)
  }
  state.recentEvents.unshift(result)
  if (state.recentEvents.length > 100) state.recentEvents.length = 100
  dbRecordCycle(key, result)
}
