// Wolf-Fin PortfolioRisk — cross-agent exposure summary + kill switch

import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getPortfolio, pauseAllAgents } from '../api/client.ts'
import type { PortfolioData } from '../types/index.ts'

export function PortfolioRisk() {
  const [data, setData]       = useState<PortfolioData | null>(null)
  const [pausing, setPausing] = useState(false)

  const load = useCallback(async () => {
    try { setData(await getPortfolio()) } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])

  const handlePauseAll = async () => {
    if (!confirm('Pause ALL running agents immediately?')) return
    setPausing(true)
    try {
      const res = await pauseAllAgents()
      if (res.ok) await load()
    } finally { setPausing(false) }
  }

  if (!data || data.agents.length === 0) return null

  const pnlColor = data.todayPnlUsd >= 0 ? 'text-green' : 'text-red'

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden mb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">Portfolio Risk</span>
        <div className="flex items-center gap-2">
          {data.running > 0 && (
            <button
              onClick={handlePauseAll}
              disabled={pausing}
              className="px-3 py-1 text-[11px] font-semibold rounded border border-red/40 text-red hover:bg-red/10 disabled:opacity-40 transition-colors"
            >
              {pausing ? 'Pausing…' : `⏸ Pause All (${data.running})`}
            </button>
          )}
          <button onClick={load} className="text-xs text-muted hover:text-text px-1.5 py-1 rounded">↻</button>
        </div>
      </div>

      <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Today P&L */}
        <div>
          <div className="text-[10px] text-muted2 uppercase tracking-widest mb-0.5">Today P&L</div>
          <div className={`text-lg font-bold font-mono ${pnlColor}`}>
            {data.todayPnlUsd >= 0 ? '+' : ''}${data.todayPnlUsd.toFixed(2)}
          </div>
        </div>

        {/* Open Exposure */}
        <div>
          <div className="text-[10px] text-muted2 uppercase tracking-widest mb-0.5">Open Exposure</div>
          <div className="text-lg font-bold font-mono text-text">
            ${data.totalNotionalUsd.toFixed(0)}
          </div>
          <div className="text-[10px] text-muted">notional</div>
        </div>

        {/* Agent Status */}
        <div>
          <div className="text-[10px] text-muted2 uppercase tracking-widest mb-1">Agents</div>
          <div className="flex gap-3 text-xs">
            <span className="text-green">{data.running} running</span>
            <span className="text-yellow">{data.paused} paused</span>
            <span className="text-muted">{data.idle} idle</span>
          </div>
        </div>

        {/* Collision Warnings */}
        <div>
          <div className="text-[10px] text-muted2 uppercase tracking-widest mb-1">Conflicts</div>
          {data.symbolCollisions.length === 0 ? (
            <div className="text-xs text-muted">None</div>
          ) : (
            <div className="space-y-0.5">
              {data.symbolCollisions.map(c => (
                <div key={c.symbol} className="text-[11px] text-yellow">
                  ⚠ {c.symbol} · {c.agentKeys.length} agents
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Per-agent strip */}
      <div className="border-t border-border/60 px-4 py-2.5 flex flex-wrap gap-2">
        {data.agents.map(a => {
          const dot = a.status === 'running' ? 'bg-green' : a.status === 'paused' ? 'bg-yellow' : 'bg-muted2'
          return (
            <Link
              key={a.agentKey}
              to={`/agents/k/${encodeURIComponent(a.agentKey)}`}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface2 border border-border/60 hover:border-border transition-colors text-[11px]"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
              <span className="text-text font-medium">{a.symbol}</span>
              {a.name && <span className="text-muted2 hidden sm:inline">({a.name})</span>}
              <span className="text-muted2 text-[9px] uppercase hidden sm:inline">{a.market}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
