import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Badge, decisionVariant } from './Badge.tsx'
import { AgentStatusBadge } from './AgentStatusBadge.tsx'
import { MarketDataModal } from './MarketDataModal.tsx'
import { startAgent, pauseAgent, stopAgent, triggerAgent, updateAgentConfig, deleteAgent, getOpenRouterModels } from '../api/client.ts'
import type { AgentState, AgentConfig, OpenRouterModel } from '../types/index.ts'

interface Props {
  agent: AgentState
  onRefresh: () => void
}

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  return `${Math.floor(d / 3600000)}h ago`
}

const INTERVALS = [2, 5, 10, 15, 20, 30, 60, 300, 900, 1800, 3600, 14400]
function intervalLabel(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${s / 60} min`
  return `${s / 3600}h`
}

export function SettingsPanel({ agent, agentKey, onSave, onDelete }: {
  agent: AgentState
  agentKey: string
  onSave: () => void
  onDelete: () => void
}) {
  const { register, handleSubmit, watch } = useForm<AgentConfig>({
    defaultValues: agent.config,
  })
  const fetchMode = watch('fetchMode')
  const llmProvider = watch('llmProvider')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [orModels, setOrModels] = useState<OpenRouterModel[]>([])
  const [orLoading, setOrLoading] = useState(false)
  const [orError, setOrError] = useState<string | null>(null)

  useEffect(() => {
    if (llmProvider === 'openrouter') {
      setOrError(null)
      setOrLoading(true)
      getOpenRouterModels()
        .then(setOrModels)
        .catch(() => setOrError('Could not load models — check your OpenRouter API key'))
        .finally(() => setOrLoading(false))
    }
  }, [llmProvider])

  const onSubmit = handleSubmit(async (data) => {
    setSaving(true)
    try {
      await updateAgentConfig(agentKey, {
        ...data,
        maxIterations: Number(data.maxIterations),
        scheduleIntervalSeconds: Number(data.scheduleIntervalSeconds),
        maxLossUsd: Number(data.maxLossUsd),
        leverage: data.leverage ? Number(data.leverage) : undefined,
      })
      onSave()
    } finally {
      setSaving(false)
    }
  })

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    await deleteAgent(agentKey)
    onDelete()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 pt-2 border-t border-border mt-3">
      {/* Paper / Live */}
      <div>
        <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Mode</label>
        <div className="flex gap-2">
          {(['true', 'false'] as const).map(val => (
            <label key={val} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" value={val} {...register('paper', { setValueAs: v => v === 'true' })}
                className="!w-auto !border-none !bg-transparent !p-0" defaultChecked={String(agent.config.paper) === val} />
              <span className={`text-xs ${val === 'true' ? 'text-yellow' : 'text-red'}`}>
                {val === 'true' ? 'Paper' : 'Live'}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Fetch Mode */}
      <div>
        <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Fetch Mode</label>
        <div className="flex gap-1">
          {(['manual', 'scheduled', 'autonomous'] as const).map(m => (
            <label key={m} className={`flex-1 text-center text-[11px] py-1.5 rounded border cursor-pointer transition-colors ${
              fetchMode === m ? 'border-green text-green bg-green-dim' : 'border-border text-muted hover:border-muted'
            }`}>
              <input type="radio" value={m} {...register('fetchMode')} className="sr-only" />
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </label>
          ))}
        </div>
      </div>

      {/* Interval */}
      {fetchMode !== 'manual' && (
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Interval</label>
          <select {...register('scheduleIntervalSeconds')} className="!w-full">
            {INTERVALS.map(s => (
              <option key={s} value={s}>{intervalLabel(s)}</option>
            ))}
          </select>
        </div>
      )}

      {/* Risk */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Max Daily Loss $</label>
          <input type="number" step="1" {...register('maxLossUsd')} />
        </div>
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Leverage</label>
          <input type="number" min="1" max="3000" placeholder="e.g. 100" {...register('leverage', { setValueAs: v => v === '' || v == null ? undefined : Number(v) })} />
        </div>
      </div>

      {/* Max iterations */}
      <div>
        <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Max Iterations</label>
        <input type="number" min="1" max="20" {...register('maxIterations')} />
      </div>

      {/* Custom prompt */}
      <div>
        <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Custom Prompt</label>
        <textarea
          {...register('customPrompt')}
          placeholder="Additional instructions appended to the system prompt..."
          rows={6}
          style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', color: '#e0e0e0', borderRadius: 4, padding: '8px 10px', fontFamily: 'Courier New, monospace', fontSize: 11, lineHeight: '1.6', outline: 'none', width: '100%', resize: 'vertical', minHeight: 100 }}
        />
      </div>

      {/* LLM Provider */}
      <div>
        <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">LLM Provider</label>
        <select {...register('llmProvider')}>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </div>

      {llmProvider === 'openrouter' && (
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">OpenRouter Model</label>
          {orLoading ? (
            <p className="text-xs text-muted py-2">Loading models...</p>
          ) : orError ? (
            <p className="text-xs text-red py-2">{orError}</p>
          ) : (
            <select {...register('llmModel')}>
              <option value="">— Select model —</option>
              {orModels.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.contextLength ? ` · ${(m.contextLength / 1000).toFixed(0)}k ctx` : ''}
                  {m.promptCost ? ` · $${(parseFloat(m.promptCost) * 1e6).toFixed(2)}/M` : ''}
                </option>
              ))}
            </select>
          )}
          {agent.config.llmModel && (
            <p className="text-[10px] text-muted mt-1">Current: {agent.config.llmModel}</p>
          )}
        </div>
      )}

      {/* Save / Delete */}
      <div className="flex items-center justify-between pt-1">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-1.5 text-xs border border-green text-green rounded hover:bg-green-dim disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button
          type="button"
          disabled={deleting}
          onClick={handleDelete}
          className={`text-xs transition-colors ${confirmDelete ? 'text-red border border-red-border rounded px-3 py-1.5 hover:bg-red-dim' : 'text-muted hover:text-red'}`}
        >
          {confirmDelete ? 'Confirm Delete?' : 'Delete Agent'}
        </button>
      </div>
    </form>
  )
}

export function AgentCard({ agent, onRefresh }: Props) {
  const [showSettings, setShowSettings] = useState(false)
  const [showMarket, setShowMarket] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const navigate = useNavigate()

  const key = `${agent.config.market}:${agent.config.symbol}`

  const act = async (fn: () => Promise<unknown>, id: string) => {
    setLoading(id)
    try { await fn() } finally { setLoading(null); onRefresh() }
  }

  const canStart   = agent.status !== 'running'
  const canPause   = agent.status === 'running'
  const canStop    = agent.status !== 'idle'

  return (
    <div className="bg-surface border border-border rounded-lg p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white font-bold text-base">{agent.config.symbol}</span>
            <Badge label={agent.config.market.toUpperCase()} variant={agent.config.market} />
            <Badge label={agent.config.paper ? 'PAPER' : 'LIVE'} variant={agent.config.paper ? 'paper' : 'live'} />
          </div>
          <AgentStatusBadge status={agent.status} />
        </div>
        <div className="flex items-center gap-1.5">
          {/* Open agent page */}
          <button
            onClick={() => navigate(`/agents/${agent.config.market}/${agent.config.symbol}`)}
            className="px-2.5 py-1 text-[11px] border border-border text-muted rounded hover:border-green hover:text-green transition-colors"
            title="Open agent page"
          >
            Open →
          </button>
          <button
            onClick={() => setShowSettings(s => !s)}
            className={`text-lg leading-none transition-colors mt-0.5 ${showSettings ? 'text-green' : 'text-muted hover:text-white'}`}
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="text-muted">Cycles: <span className="text-white">{agent.cycleCount}</span></div>
        <div className="text-muted">Mode: <span className="text-white">{agent.config.fetchMode}</span></div>
        {agent.config.fetchMode !== 'manual' && (
          <div className="text-muted">Interval: <span className="text-white">{intervalLabel(agent.config.scheduleIntervalSeconds)}</span></div>
        )}
        {agent.startedAt && (
          <div className="text-muted">Started: <span className="text-white">{rel(agent.startedAt)}</span></div>
        )}
        {agent.config.leverage && (
          <div className="text-muted">Leverage: <span className="text-white">{agent.config.leverage}:1</span></div>
        )}
      </div>

      {/* Last decision */}
      {agent.lastCycle ? (
        <div className="border border-border rounded p-2.5 bg-surface2">
          <div className="flex items-center gap-2 mb-1">
            <Badge label={agent.lastCycle.decision} variant={decisionVariant(agent.lastCycle.decision)} />
            <span className="text-muted text-[10px]">{rel(agent.lastCycle.time)}</span>
          </div>
          {agent.lastCycle.reason && (
            <p className="text-muted text-[11px] leading-relaxed line-clamp-2">{agent.lastCycle.reason}</p>
          )}
          {agent.lastCycle.error && (
            <p className="text-red text-[11px] mt-1">Error: {agent.lastCycle.error}</p>
          )}
        </div>
      ) : (
        <div className="border border-border rounded p-2.5 bg-surface2 text-muted text-xs">No cycles run yet</div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-1.5">
        <button
          disabled={!canStart || loading !== null}
          onClick={() => act(() => startAgent(key), 'start')}
          className="px-2.5 py-1 text-[11px] border border-green-border text-green rounded hover:bg-green-dim disabled:opacity-25 disabled:cursor-default transition-colors"
        >
          {loading === 'start' ? '...' : '▶ Start'}
        </button>
        <button
          disabled={!canPause || loading !== null}
          onClick={() => act(() => pauseAgent(key), 'pause')}
          className="px-2.5 py-1 text-[11px] border border-yellow/30 text-yellow rounded hover:bg-yellow-dim disabled:opacity-25 disabled:cursor-default transition-colors"
        >
          {loading === 'pause' ? '...' : '⏸ Pause'}
        </button>
        <button
          disabled={!canStop || loading !== null}
          onClick={() => act(() => stopAgent(key), 'stop')}
          className="px-2.5 py-1 text-[11px] border border-red-border text-red rounded hover:bg-red-dim disabled:opacity-25 disabled:cursor-default transition-colors"
        >
          {loading === 'stop' ? '...' : '■ Stop'}
        </button>
        <button
          disabled={loading !== null}
          onClick={() => act(() => triggerAgent(key), 'trigger')}
          className="px-2.5 py-1 text-[11px] border border-blue-500/30 text-blue-400 rounded hover:bg-blue-900/20 disabled:opacity-25 disabled:cursor-default transition-colors"
        >
          {loading === 'trigger' ? 'Running...' : '⚡ Trigger'}
        </button>
        <button
          disabled={loading !== null}
          onClick={() => setShowMarket(true)}
          className="px-2.5 py-1 text-[11px] border border-border text-muted rounded hover:border-muted hover:text-white transition-colors"
        >
          📊
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel
          agent={agent}
          agentKey={key}
          onSave={() => { setShowSettings(false); onRefresh() }}
          onDelete={() => onRefresh()}
        />
      )}

      {/* Market data modal */}
      {showMarket && (
        <MarketDataModal
          market={agent.config.market}
          symbol={agent.config.symbol}
          onClose={() => setShowMarket(false)}
        />
      )}
    </div>
  )
}
