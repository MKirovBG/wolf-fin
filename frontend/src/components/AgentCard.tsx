import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Badge, decisionVariant } from './Badge.tsx'
import { AgentStatusBadge } from './AgentStatusBadge.tsx'
import { updateAgentConfig, deleteAgent, getOpenRouterModels } from '../api/client.ts'
import type { AgentState, AgentConfig, OpenRouterModel } from '../types/index.ts'
import { useToast } from './Toast.tsx'

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
  const { register, handleSubmit, watch, reset } = useForm<AgentConfig>({
    defaultValues: agent.config,
  })

  // Only reset form when config values actually change on the server (not on every re-render).
  // Using JSON snapshot prevents the form wiping unsaved edits on every polling refresh.
  const configSnapshot = JSON.stringify(agent.config)
  useEffect(() => {
    reset(agent.config)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configSnapshot])

  const fetchMode = watch('fetchMode')
  const llmProvider = watch('llmProvider')
  const isRunning = agent.status === 'running'
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const toast = useToast()
  const [orModels, setOrModels] = useState<OpenRouterModel[]>([])
  const [orLoading, setOrLoading] = useState(false)
  const [orError, setOrError] = useState<string | null>(null)
  const [showFreeOnly, setShowFreeOnly] = useState(false)

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
      const saved: Partial<AgentConfig> = {
        ...data,
        scheduleIntervalSeconds: Number(data.scheduleIntervalSeconds),
        leverage: data.leverage ? Number(data.leverage) : undefined,
        maxDrawdownPercent: data.maxDrawdownPercent ? Number(data.maxDrawdownPercent) : undefined,
        scheduledStartUtc: data.scheduledStartUtc || undefined,
        scheduledEndUtc: data.scheduledEndUtc || undefined,
      }
      await updateAgentConfig(agentKey, saved)
      toast.success('Configuration saved')
      onSave()
    } catch {
      toast.error('Failed to save — check the server logs')
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
    <form onSubmit={onSubmit} className="space-y-4 pt-3 border-t border-border mt-3">
      {isRunning && (
        <div className="text-sm text-yellow border border-yellow/30 bg-yellow-dim rounded-lg px-3 py-2.5">
          Stop or pause the agent before editing its configuration.
        </div>
      )}
      <fieldset disabled={isRunning || saving} style={{ border: 'none', padding: 0, margin: 0 }} className="space-y-4">

        {/* Fetch Mode */}
        <div>
          <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-2">Fetch Mode</label>
          <div className="flex gap-1.5">
            {(['manual', 'scheduled', 'autonomous'] as const).map(m => (
              <label key={m} className={`flex-1 text-center text-sm py-2 rounded-lg border cursor-pointer transition-colors ${
                fetchMode === m ? 'border-green text-green bg-green-dim' : 'border-border text-muted hover:border-muted hover:text-text'
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
            <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-2">Interval</label>
            <select {...register('scheduleIntervalSeconds')} className="!w-full">
              {INTERVALS.map(s => (
                <option key={s} value={s}>{intervalLabel(s)}</option>
              ))}
            </select>
          </div>
        )}

        {/* Leverage */}
        <div>
          <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-2">Leverage</label>
          <input type="number" min="1" max="3000" placeholder="e.g. 100" {...register('leverage', { setValueAs: v => v === '' || v == null ? undefined : Number(v) })} />
        </div>

        {/* Max daily loss */}
        <div>
          <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-2">Max Daily Loss (USD)</label>
          <input
            type="number" min="1" step="1"
            placeholder="e.g. 50 — auto-pauses when daily P&L ≤ -this"
            {...register('maxDailyLossUsd', { setValueAs: v => v === '' || v == null ? undefined : Number(v) })}
          />
        </div>

        {/* Drawdown auto-pause */}
        <div>
          <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-2">Max Drawdown (%)</label>
          <input
            type="number" min="1" max="100" step="0.5"
            placeholder="e.g. 5 — auto-pauses when equity drops 5% below session peak"
            {...register('maxDrawdownPercent', { setValueAs: v => v === '' || v == null ? undefined : Number(v) })}
          />
        </div>

        {/* Scheduled window */}
        {fetchMode !== 'manual' && (
          <div>
            <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-2">Scheduled Window (UTC)</label>
            <div className="flex items-center gap-2">
              <input type="time" className="flex-1" placeholder="08:00" {...register('scheduledStartUtc')} />
              <span className="text-muted text-xs">to</span>
              <input type="time" className="flex-1" placeholder="17:00" {...register('scheduledEndUtc')} />
            </div>
            <p className="text-xs text-muted2 mt-1">Leave empty to run 24/7. Supports midnight-spanning windows (e.g. 22:00 → 06:00).</p>
          </div>
        )}

        {/* Custom prompt */}
        <div>
          <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-2">Custom Instructions</label>
          <textarea
            {...register('customPrompt')}
            placeholder="Additional instructions appended to the system prompt..."
            rows={5}
            className="font-mono text-xs"
          />
        </div>

        {/* LLM Provider */}
        <div>
          <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-2">LLM Provider</label>
          <select {...register('llmProvider')}>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </div>

        {llmProvider === 'openrouter' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted uppercase tracking-wider">OpenRouter Model</label>
              <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showFreeOnly}
                  onChange={e => setShowFreeOnly(e.target.checked)}
                  className="rounded border-border"
                />
                Free only
              </label>
            </div>
            {orLoading ? (
              <p className="text-sm text-muted py-2">Loading models...</p>
            ) : orError ? (
              <p className="text-sm text-red py-2">{orError}</p>
            ) : (
              <>
                <select {...register('llmModel')}>
                  <option value="">— Select model —</option>
                  {orModels
                    .filter(m => {
                      const cost = parseFloat(m.promptCost ?? '1')
                      return showFreeOnly ? cost === 0 : cost > 0
                    })
                    .map(m => {
                      const inputCost = parseFloat(m.promptCost ?? '0')
                      const outputCost = parseFloat(m.completionCost ?? '0')
                      const isFree = inputCost === 0 && outputCost === 0
                      const costLabel = isFree
                        ? 'FREE'
                        : `$${(inputCost * 1e6).toFixed(2)}/$${(outputCost * 1e6).toFixed(2)} per M`
                      return (
                        <option key={m.id} value={m.id}>
                          {m.name} · {(m.contextLength / 1000).toFixed(0)}k · {costLabel}
                        </option>
                      )
                    })}
                </select>
                <p className="text-[10px] text-muted mt-1">
                  {showFreeOnly
                    ? `${orModels.filter(m => parseFloat(m.promptCost ?? '1') === 0).length} free models`
                    : `${orModels.filter(m => parseFloat(m.promptCost ?? '1') > 0).length} paid models`
                  } · cost shown as input/output per 1M tokens
                </p>
              </>
            )}
            {agent.config.llmModel && (
              <p className="text-xs text-muted mt-1.5">Current: <span className="font-mono text-text">{agent.config.llmModel}</span></p>
            )}
          </div>
        )}

      </fieldset>

      {/* Save / Delete */}
      <div className="flex items-center justify-between pt-1">
        <button
          type="submit"
          disabled={isRunning || saving}
          className="px-5 py-2 text-sm border border-green text-green rounded-lg hover:bg-green-dim disabled:opacity-40 transition-colors font-medium"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button
          type="button"
          disabled={deleting}
          onClick={handleDelete}
          className={`text-sm transition-colors ${confirmDelete ? 'text-red border border-red/30 rounded-lg px-4 py-2 hover:bg-red-dim' : 'text-muted hover:text-red'}`}
        >
          {confirmDelete ? 'Confirm Delete?' : 'Delete Agent'}
        </button>
      </div>
    </form>
  )
}

export function AgentCard({ agent }: Props) {
  const navigate = useNavigate()
  const { market, symbol } = agent.config
  // agentKey comes directly from the API — no reconstruction needed
  const agentPath = `/agents/k/${encodeURIComponent(agent.agentKey)}`

  return (
    <div
      className="bg-surface border border-border rounded-lg p-4 flex flex-col gap-3 cursor-pointer hover:border-muted2 transition-colors"
      onClick={() => navigate(agentPath)}
    >
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-text font-bold text-base">{symbol}</span>
            <Badge label={market.toUpperCase()} variant={market} />
            {agent.config.leverage && (
              <span className="text-xs text-muted border border-border rounded px-1.5 py-0.5">{agent.config.leverage}:1</span>
            )}
            {agent.config.name && (
              <span className="text-xs text-muted ml-2">— {agent.config.name}</span>
            )}
          </div>
          <AgentStatusBadge status={agent.status} />
        </div>
        <button
          onClick={e => { e.stopPropagation(); navigate(agentPath) }}
          className="px-3 py-1.5 text-xs border border-border text-muted rounded-lg hover:border-green hover:text-green transition-colors shrink-0"
        >
          Open
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <div className="text-muted">Cycles <span className="text-text font-medium ml-1">{agent.cycleCount}</span></div>
        <div className="text-muted">Mode <span className="text-text font-medium ml-1">{agent.config.fetchMode}</span></div>
        {agent.config.fetchMode !== 'manual' && (
          <div className="text-muted">Interval <span className="text-text font-medium ml-1">{intervalLabel(agent.config.scheduleIntervalSeconds)}</span></div>
        )}
        {agent.startedAt && (
          <div className="text-muted">Started <span className="text-text font-medium ml-1">{rel(agent.startedAt)}</span></div>
        )}
        <div className="text-muted">LLM <span className="text-text font-medium ml-1">{agent.config.llmProvider ?? 'anthropic'}</span></div>
      </div>

      {/* Last decision */}
      {agent.lastCycle ? (
        <div className="border border-border rounded-lg p-3 bg-surface2">
          <div className="flex items-center gap-2 mb-1.5">
            <Badge label={agent.lastCycle.decision} variant={decisionVariant(agent.lastCycle.decision)} />
            <span className="text-muted text-xs">{rel(agent.lastCycle.time)}</span>
          </div>
          {agent.lastCycle.reason && (
            <p className="text-muted text-sm leading-relaxed line-clamp-2">{agent.lastCycle.reason}</p>
          )}
          {agent.lastCycle.error && (
            <p className="text-red text-sm mt-1">Error: {agent.lastCycle.error}</p>
          )}
        </div>
      ) : (
        <div className="border border-border rounded-lg p-3 bg-surface2 text-muted text-sm">No cycles run yet</div>
      )}
    </div>
  )
}
