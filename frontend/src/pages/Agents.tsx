import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAgents } from '../api/client.ts'
import type { AgentState } from '../types/index.ts'
import { AgentCard } from '../components/AgentCard.tsx'

export function Agents() {
  const [agents, setAgents] = useState<AgentState[]>([])
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try { setAgents(await getAgents()) } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  const running = agents.filter(a => a.status === 'running').length

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-sm font-bold tracking-widest text-white uppercase">Agents</h1>
          <p className="text-muted text-xs mt-1">
            {agents.length} agent{agents.length !== 1 ? 's' : ''} · {running} running
          </p>
        </div>
        <button
          onClick={() => navigate('/agents/new')}
          className="px-4 py-2 text-xs border border-green text-green rounded hover:bg-green-dim transition-colors"
        >
          + New Agent
        </button>
      </div>

      {/* Agent cards grid */}
      {agents.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-12 text-center">
          <div className="text-4xl mb-4">🤖</div>
          <h2 className="text-white text-sm font-bold mb-2">No agents configured</h2>
          <p className="text-muted text-xs mb-4">Add an agent to start monitoring markets and trading.</p>
          <button
            onClick={() => navigate('/agents/new')}
            className="px-5 py-2 text-xs border border-green text-green rounded hover:bg-green-dim transition-colors"
          >
            + Add Your First Agent
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map(agent => {
            const key = `${agent.config.market}:${agent.config.symbol}`
            return <AgentCard key={key} agent={agent} onRefresh={load} />
          })}
        </div>
      )}

      {/* Info panel */}
      <div className="mt-6 bg-surface border border-border rounded-lg p-4">
        <h3 className="text-[10px] font-bold tracking-widest text-muted uppercase mb-3">How Agents Work</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted">
          <div>
            <div className="text-white mb-1">▶ Start</div>
            Activates the agent. In <span className="text-white">scheduled</span> or <span className="text-white">autonomous</span> mode it will run automatically on its configured interval.
          </div>
          <div>
            <div className="text-white mb-1">⚡ Trigger</div>
            Runs a single analysis cycle immediately, regardless of schedule. The agent will analyse the market and potentially place a trade.
          </div>
          <div>
            <div className="text-white mb-1">📊 Market Data</div>
            Fetches a live market snapshot (price, candles, indicators) <span className="text-green">without</span> running the AI or placing any trades. Safe to use at any time.
          </div>
        </div>
      </div>
    </div>
  )
}
