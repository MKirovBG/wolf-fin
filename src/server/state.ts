// Wolf-Fin — shared in-memory state

import type { AgentState, AgentStatus, CycleResult } from '../types.js'

// Re-export for modules that used to import CycleResult from here
export type { CycleResult } from '../types.js'

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
}

export function removeAgent(key: string): void {
  delete state.agents[key]
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
  }
}

export function recordCycle(key: string, result: CycleResult): void {
  const agent = state.agents[key]
  if (agent) {
    agent.lastCycle = result
    agent.cycleCount++
  }
  state.recentEvents.unshift(result)
  if (state.recentEvents.length > 100) state.recentEvents.length = 100
}
