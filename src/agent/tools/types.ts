import type { AgentConfig } from '../../types.js'

/** Context passed to every tool handler. Contains all data needed to execute any tool. */
export interface DispatchCtx {
  input:         Record<string, unknown>
  market:        'crypto' | 'mt5'
  mt5AccountId:  number | undefined
  agentKey:      string
  agentConfig:   AgentConfig | undefined
  /** Lot size computed by position-sizing logic — execution handler uses this for the 2× clamp. */
  suggestedLots: number | undefined
}
