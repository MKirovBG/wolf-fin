import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getAgents } from '../api/client.ts'
import type { AgentState } from '../types/index.ts'
import { AgentCard } from '../components/AgentCard.tsx'
import { useAccount } from '../contexts/AccountContext.tsx'

export function Agents() {
  const [agents, setAgents] = useState<AgentState[]>([])
  const navigate = useNavigate()
  const { selectedAccount } = useAccount()

  // Reload agents whenever selected account changes
  useEffect(() => {
    const filter = selectedAccount
      ? { market: selectedAccount.market, accountId: selectedAccount.accountId }
      : undefined
    getAgents(filter).then(setAgents).catch(() => {})
  }, [selectedAccount])

  // SSE — update individual agent cards in real-time (filtered to selected account)
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('agent', (e: MessageEvent) => {
      try {
        const updated = JSON.parse(e.data) as AgentState & { agentKey: string }
        // Only accept updates for agents belonging to selected account
        if (selectedAccount) {
          const cfg = updated.config
          if (cfg.market !== selectedAccount.market) return
          if (cfg.market === 'mt5' && String(cfg.mt5AccountId ?? '') !== selectedAccount.accountId) return
        }
        setAgents(prev =>
          prev.some(a => a.agentKey === updated.agentKey)
            ? prev.map(a => a.agentKey === updated.agentKey ? updated : a)
            : [...prev, updated]
        )
      } catch { /* ignore */ }
    })
    return () => es.close()
  }, [selectedAccount])

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

      {/* No account selected */}
      {!selectedAccount && (
        <div className="bg-surface border border-yellow/30 rounded-lg p-12 text-center">
          <div className="text-4xl mb-4 opacity-40">◎</div>
          <h2 className="text-text text-base font-bold mb-2">No account selected</h2>
          <p className="text-muted text-sm mb-4">Select an account from the sidebar to view its agents.</p>
          <Link to="/account" className="text-sm text-yellow underline underline-offset-2">
            Manage accounts →
          </Link>
        </div>
      )}

      {/* Agent cards grid */}
      {selectedAccount && agents.length === 0 && (
        <div className="bg-surface border border-border rounded-lg p-12 text-center">
          <div className="text-5xl mb-4 opacity-40">◎</div>
          <h2 className="text-text text-base font-bold mb-2">No agents for this account</h2>
          <p className="text-muted text-sm mb-5">
            No agents configured for <span className="text-text font-mono">{selectedAccount.label ?? selectedAccount.accountId}</span>.
          </p>
          <button
            onClick={() => navigate('/agents/new')}
            className="px-5 py-2.5 text-sm border border-green text-green rounded-lg hover:bg-green-dim transition-colors font-medium"
          >
            + Add First Agent
          </button>
        </div>
      )}

      {selectedAccount && agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map(agent => (
            <AgentCard
              key={agent.agentKey}
              agent={agent}
              onRefresh={() => getAgents({ market: selectedAccount.market, accountId: selectedAccount.accountId }).then(setAgents).catch(() => {})}
            />
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
