// Wolf-Fin — shared in-memory state for the HTTP dashboard

import type { AgentConfig } from '../agent/index.js'

export interface CycleResult {
  symbol: string
  market: 'crypto' | 'forex'
  paper: boolean
  decision: string
  reason: string
  time: string
  error?: string
}

interface AppState {
  status: 'idle' | 'running' | 'paused'
  paused: boolean
  paperMode: boolean
  configs: AgentConfig[]
  lastCycleByKey: Record<string, CycleResult>
  recentEvents: CycleResult[]
  startedAt: string | null
}

const state: AppState = {
  status: 'idle',
  paused: false,
  paperMode: true,
  configs: [],
  lastCycleByKey: {},
  recentEvents: [],
  startedAt: null,
}

export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch)
}

export function recordCycle(result: CycleResult): void {
  const key = `${result.market}:${result.symbol}`
  state.lastCycleByKey[key] = result
  state.recentEvents.unshift(result)
  if (state.recentEvents.length > 50) state.recentEvents.length = 50
}

export function getState(): Readonly<AppState> {
  return state
}
