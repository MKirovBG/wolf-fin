import { useEffect, useState } from 'react'
import { getAgentState } from '../api/client.ts'
import type { AgentState } from '../types/index.ts'

const STATUS_STYLES: Record<string, string> = {
  idle:      'text-green bg-green/10',
  analyzing: 'text-yellow bg-yellow-dim',
  error:     'text-red bg-red/10',
}

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000)    return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000)  return `${Math.floor(d / 60000)}m ago`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`
  return `${Math.floor(d / 86400000)}d ago`
}

export function AgentStatePanel() {
  const [state, setState] = useState<AgentState | null>(null)

  useEffect(() => {
    const load = () => getAgentState().then(setState).catch(() => {})
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [])

  if (!state) return null

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Agent Status</span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${STATUS_STYLES[state.status] ?? 'text-muted bg-surface2'}`}>
          {state.status === 'analyzing' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow mr-1 animate-pulse" />}
          {state.status.toUpperCase()}
        </span>
      </div>

      {state.currentTask && (
        <div className="text-xs text-text">{state.currentTask}</div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <div className="text-lg font-bold text-text font-mono">{state.totalRuns}</div>
          <div className="text-[10px] text-muted2">Total Runs</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-red font-mono">{state.totalErrors}</div>
          <div className="text-[10px] text-muted2">Errors</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-medium text-text font-mono">{state.lastRunAt ? rel(state.lastRunAt) : '--'}</div>
          <div className="text-[10px] text-muted2">Last Run</div>
        </div>
      </div>

      {state.recentErrors.length > 0 && (
        <div className="space-y-1 border-t border-border pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted2">Recent Errors</div>
          {state.recentErrors.slice(0, 3).map((err, i) => (
            <div key={i} className="text-[11px] text-red/80 truncate" title={err.message}>
              <span className="text-muted2 mr-1">{rel(err.time)}</span>
              {err.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
