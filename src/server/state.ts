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
  makeAgentKey,
} from '../db/index.js'

// ── Cycle in-flight lock — prevents concurrent runs for the same agent ────────

const cyclesInFlight = new Set<string>()

export function tryAcquireCycleLock(agentKey: string): boolean {
  if (cyclesInFlight.has(agentKey)) return false
  cyclesInFlight.add(agentKey)
  return true
}

export function releaseCycleLock(agentKey: string): void {
  cyclesInFlight.delete(agentKey)
}

// ── Queued planning requests — allows Plan button to work while agent is running ──

const pendingPlanRequests = new Set<string>()

export function queuePlanRequest(agentKey: string): void {
  pendingPlanRequests.add(agentKey)
}

export function consumePlanRequest(agentKey: string): boolean {
  if (pendingPlanRequests.has(agentKey)) {
    pendingPlanRequests.delete(agentKey)
    return true
  }
  return false
}

// ── Log buffer ────────────────────────────────────────────────────────────────

// Initialized lazily on first use so it reads from DB after initDb() has run
let logSeq = -1
function nextLogId(): number {
  if (logSeq === -1) logSeq = dbGetMaxLogId()
  return ++logSeq
}
const logBuffer: LogEntry[] = []

// ── SSE subscriber registries ─────────────────────────────────────────────────

type LogSubscriber = (entry: LogEntry) => void
const logSubscribers = new Set<LogSubscriber>()

export function subscribeToLogs(cb: LogSubscriber): () => void {
  logSubscribers.add(cb)
  return () => logSubscribers.delete(cb)
}

export interface AgentStatusEvent {
  type: 'agent_update'
  agentKey: string
  agent: AgentState
}

type AgentStatusSubscriber = (event: AgentStatusEvent) => void
const agentStatusSubscribers = new Set<AgentStatusSubscriber>()

export function subscribeToAgentStatus(cb: AgentStatusSubscriber): () => void {
  agentStatusSubscribers.add(cb)
  return () => agentStatusSubscribers.delete(cb)
}

function broadcastAgentUpdate(key: string): void {
  const agent = state.agents[key]
  if (!agent) return
  const event: AgentStatusEvent = { type: 'agent_update', agentKey: key, agent }
  for (const sub of agentStatusSubscribers) {
    try { sub(event) } catch { /* ignore */ }
  }
}

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
  // Broadcast to SSE subscribers
  for (const sub of logSubscribers) {
    try { sub(entry) } catch { /* ignore subscriber errors */ }
  }
}

export function getLogs(sinceId?: number, agentKey?: string, limit = 200): LogEntry[] {
  return dbGetLogs(sinceId, agentKey, limit)
}

interface AppState {
  agents: Record<string, AgentState>   // key = makeAgentKey(market, symbol, accountId, name)
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
  const key = makeAgentKey(agent.config.market, agent.config.symbol, agent.config.mt5AccountId, agent.config.name)
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
    broadcastAgentUpdate(key)
  }
}

export function recordCycle(key: string, result: CycleResult): void {
  const isExternalClose = result.decision === 'EXTERNAL_CLOSE'
  const agent = state.agents[key]
  if (agent) {
    // Don't overwrite lastCycle for EXTERNAL_CLOSE — it's a pre-tick detection event,
    // not the agent's actual decision. The real decision comes when the tick finishes.
    if (!isExternalClose) {
      agent.lastCycle = result
    }
    agent.cycleCount++
    dbUpsertAgent(agent)
    broadcastAgentUpdate(key)
  }
  state.recentEvents.unshift(result)
  if (state.recentEvents.length > 100) state.recentEvents.length = 100
  dbRecordCycle(key, result)
}
