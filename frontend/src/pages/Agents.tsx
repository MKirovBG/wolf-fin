import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAgents } from '../api/client.ts'
import type { AgentState } from '../types/index.ts'
import { AgentCard } from '../components/AgentCard.tsx'

export function Agents() {
  const [agents, setAgents] = useState<AgentState[]>([])
  const navigate = useNavigate()

  // Initial load
  useEffect(() => {
    getAgents().then(setAgents).catch(() => {})
  }, [])

  // SSE — update individual agent cards in real-time
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('agent', (e: MessageEvent) => {
      try {
        const updated = JSON.parse(e.data) as AgentState & { agentKey: string }
        setAgents(prev =>
          prev.some(a => a.agentKey === updated.agentKey)
            ? prev.map(a => a.agentKey === updated.agentKey ? updated : a)
            : [...prev, updated]
        )
      } catch { /* ignore */ }
    })
    return () => es.close()
  }, [])

  const running = agents.filter(a => a.status === 'running').length

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-xl font-bold text-text">Agents</h1>
          <p className="text-muted text-sm mt-1">
            {agents.length} agent{agents.length !== 1 ? 's' : ''} · {running} running
            <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded text-green bg-green-dim">● LIVE</span>
          </p>
        </div>
        <button
          onClick={() => navigate('/agents/new')}
          className="px-4 py-2 text-sm border border-green text-green rounded-lg hover:bg-green-dim transition-colors font-medium"
        >
          + New Agent
        </button>
      </div>

      {/* Agent cards grid */}
      {agents.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-12 text-center">
          <div className="text-5xl mb-4 opacity-40">◎</div>
          <h2 className="text-text text-base font-bold mb-2">No agents configured</h2>
          <p className="text-muted text-sm mb-5">Add an agent to start monitoring markets and trading.</p>
          <button
            onClick={() => navigate('/agents/new')}
            className="px-5 py-2.5 text-sm border border-green text-green rounded-lg hover:bg-green-dim transition-colors font-medium"
          >
            + Add Your First Agent
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map(agent => (
            <AgentCard key={agent.agentKey} agent={agent} onRefresh={() => getAgents().then(setAgents).catch(() => {})} />
          ))}
        </div>
      )}

      {/* Info panel */}
      <div className="mt-6 bg-surface border border-border rounded-lg p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-4">How Agents Work</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-sm text-muted">
          <div>
            <div className="text-text font-semibold mb-1.5">▶ Start</div>
            Activates the agent. In <span className="text-text">scheduled</span> or <span className="text-text">autonomous</span> mode it runs automatically on its configured interval.
          </div>
          <div>
            <div className="text-text font-semibold mb-1.5">⚡ Trigger</div>
            Runs a single analysis cycle immediately, regardless of schedule. The agent will analyse the market and potentially place a trade.
          </div>
          <div>
            <div className="text-text font-semibold mb-1.5">Market Data</div>
            Fetches a live market snapshot (price, candles, indicators) <span className="text-green">without</span> running the AI or placing any trades. Safe to use at any time.
          </div>
        </div>
      </div>
    </div>
  )
}
