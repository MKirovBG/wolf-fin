// Wolf-Fin — shared domain types (zero internal imports)

export type AgentStatus = 'idle' | 'running' | 'paused'

export interface AgentConfig {
  symbol: string
  market: 'crypto' | 'forex'
  paper: boolean
  maxIterations: number
  fetchMode: 'manual' | 'scheduled' | 'autonomous'
  scheduleIntervalMinutes: number
  maxLossUsd: number
  maxPositionUsd: number
  customPrompt?: string
}

export interface AgentState {
  config: AgentConfig
  status: AgentStatus
  lastCycle: CycleResult | null
  startedAt: string | null
  cycleCount: number
}

export interface CycleResult {
  symbol: string
  market: 'crypto' | 'forex'
  paper: boolean
  decision: string
  reason: string
  time: string
  error?: string
}
