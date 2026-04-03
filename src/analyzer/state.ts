// Wolf-Fin — Agent state tracker (in-memory)
// Tracks what the agent is doing right now for the Agent State Panel.

export interface AgentState {
  status:         'idle' | 'analyzing' | 'error'
  currentTask:    string | null
  currentSymbol:  string | null
  queueDepth:     number
  lastRunAt:      string | null
  lastError:      string | null
  recentErrors:   Array<{ time: string; message: string }>
  totalRuns:      number
  totalErrors:    number
}

const state: AgentState = {
  status:        'idle',
  currentTask:   null,
  currentSymbol: null,
  queueDepth:    0,
  lastRunAt:     null,
  lastError:     null,
  recentErrors:  [],
  totalRuns:     0,
  totalErrors:   0,
}

export function getAgentState(): AgentState {
  return { ...state, recentErrors: [...state.recentErrors] }
}

export function setAnalyzing(symbolKey: string, task: string): void {
  state.status = 'analyzing'
  state.currentTask = task
  state.currentSymbol = symbolKey
}

export function setIdle(): void {
  state.status = 'idle'
  state.currentTask = null
  state.currentSymbol = null
  state.lastRunAt = new Date().toISOString()
  state.totalRuns++
}

export function setError(message: string): void {
  state.status = 'error'
  state.lastError = message
  state.totalErrors++
  state.recentErrors.unshift({ time: new Date().toISOString(), message })
  if (state.recentErrors.length > 5) state.recentErrors.pop()
}

export function setQueueDepth(depth: number): void {
  state.queueDepth = depth
}
