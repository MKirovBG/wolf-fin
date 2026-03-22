import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Badge, decisionVariant } from './Badge.tsx'
import { AgentStatusBadge } from './AgentStatusBadge.tsx'
import { updateAgentConfig, deleteAgent, getOpenRouterModels, getOllamaModels } from '../api/client.ts'
import type { AgentState, AgentConfig, IndicatorConfig, CandleConfig, ContextConfig, MCEnhancements, OpenRouterModel, OllamaModel } from '../types/index.ts'
import { MC_ENHANCEMENT_DEFAULTS, MC_ENHANCEMENT_LABELS } from '../types/index.ts'
import { IndicatorConfigEditor, CandleConfigEditor, ContextConfigEditor } from './DataConfigEditors.tsx'
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
  const [indicatorConfig, setIndicatorConfig] = useState<IndicatorConfig>(agent.config.indicatorConfig ?? {})
  const [candleConfig, setCandleConfig] = useState<CandleConfig>(agent.config.candleConfig ?? {})
  const [contextConfig, setContextConfig] = useState<ContextConfig>(agent.config.contextConfig ?? {})
  const [mcEnhancements, setMcEnhancements] = useState<MCEnhancements>(agent.config.mcEnhancements ?? MC_ENHANCEMENT_DEFAULTS)

  // Re-sync deep configs when server config changes
  useEffect(() => {
    setIndicatorConfig(agent.config.indicatorConfig ?? {})
    setCandleConfig(agent.config.candleConfig ?? {})
    setContextConfig(agent.config.contextConfig ?? {})
    setMcEnhancements(agent.config.mcEnhancements ?? MC_ENHANCEMENT_DEFAULTS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configSnapshot])
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const toast = useToast()
  const [orModels, setOrModels] = useState<OpenRouterModel[]>([])
  const [orLoading, setOrLoading] = useState(false)
  const [orError, setOrError] = useState<string | null>(null)
  const [showFreeOnly, setShowFreeOnly] = useState(
    () => (agent.config.llmModel ?? '').endsWith(':free')
  )
  const [olModels, setOlModels] = useState<OllamaModel[]>([])
  const [olLoading, setOlLoading] = useState(false)
  const [olError, setOlError] = useState<string | null>(null)

  useEffect(() => {
    if (llmProvider === 'openrouter') {
      setOrError(null)
      setOrLoading(true)
      getOpenRouterModels()
        .then(setOrModels)
        .catch(() => setOrError('Could not load models — check your OpenRouter API key'))
        .finally(() => setOrLoading(false))
    }
    if (llmProvider === 'ollama') {
      setOlError(null)
      setOlLoading(true)
      getOllamaModels()
        .then(setOlModels)
        .catch(() => setOlError('Could not reach Ollama — is it running?'))
        .finally(() => setOlLoading(false))
    }
  }, [llmProvider])

  const onSubmit = handleSubmit(async (data) => {
    setSaving(true)
    try {
      const saved: Partial<AgentConfig> = {
        ...data,
        leverage: data.leverage ? Number(data.leverage) : undefined,
        maxDrawdownPercent: data.maxDrawdownPercent ? Number(data.maxDrawdownPercent) : undefined,
        scheduledStartUtc: data.scheduledStartUtc || undefined,
        scheduledEndUtc: data.scheduledEndUtc || undefined,
        indicatorConfig: Object.keys(indicatorConfig).length > 0 ? indicatorConfig : undefined,
        candleConfig: Object.keys(candleConfig).length > 0 ? candleConfig : undefined,
        contextConfig: Object.keys(contextConfig).length > 0 ? contextConfig : undefined,
        mcEnhancements,
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

  // ── Shared sub-components scoped to this form ──────────────────────────────
  const ConfigSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="bg-surface2 border border-border/70 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/70 bg-surface">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )

  const FieldLabel = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
    <div className="mb-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted block">{children}</label>
      {hint && <p className="text-xs text-muted2 mt-0.5 leading-relaxed">{hint}</p>}
    </div>
  )

  return (
    <form onSubmit={onSubmit} className="space-y-3 pt-3 border-t border-border mt-3">
      {isRunning && (
        <div className="text-sm text-yellow border border-yellow/30 bg-yellow-dim rounded-lg px-3 py-2.5">
          Stop or pause the agent before editing its configuration.
        </div>
      )}

      <fieldset disabled={isRunning || saving} style={{ border: 'none', padding: 0, margin: 0 }} className="space-y-3">

        {/* ── Execution ── */}
        <ConfigSection title="Execution">
          <div className="space-y-4">
            <div>
              <FieldLabel hint="How the agent schedules its ticks. Autonomous runs tick-to-tick continuously; Scheduled adds a trading window; Manual requires explicit triggering.">Fetch Mode</FieldLabel>
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

            {fetchMode !== 'manual' && (
              <div>
                <FieldLabel hint="Restricts the agent to a UTC time window. Leave empty to run 24/7. Supports midnight-spanning windows (e.g. 22:00 → 06:00).">Trading window (UTC)</FieldLabel>
                <div className="flex items-center gap-2">
                  <input type="time" className="flex-1" placeholder="08:00" {...register('scheduledStartUtc')} />
                  <span className="text-muted text-xs shrink-0">to</span>
                  <input type="time" className="flex-1" placeholder="17:00" {...register('scheduledEndUtc')} />
                </div>
              </div>
            )}
          </div>
        </ConfigSection>

        {/* ── Risk Management ── */}
        <ConfigSection title="Risk Management">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 items-start">
            <div>
              <FieldLabel hint="Broker leverage multiplier — used for position sizing calculations.">Leverage</FieldLabel>
              <input type="number" min="1" max="3000" placeholder="e.g. 100"
                {...register('leverage', { setValueAs: v => v === '' || v == null ? undefined : Number(v) })} />
            </div>
            <div>
              <FieldLabel hint="Daily profit target in USD. The agent sizes positions to reach this at TP. Leave empty to disable.">Daily target (USD)</FieldLabel>
              <input type="number" min="1" step="1" placeholder="e.g. 500"
                {...register('dailyTargetUsd', { setValueAs: v => v === '' || v == null ? undefined : Number(v) })} />
            </div>
            <div>
              <FieldLabel hint="Maximum % of account equity the agent may risk on a single trade.">Max risk / trade (%)</FieldLabel>
              <input type="number" min="0.5" max="50" step="0.5" placeholder="e.g. 2"
                {...register('maxRiskPercent', { setValueAs: v => v === '' || v == null ? undefined : Number(v) })} />
            </div>
            <div>
              <FieldLabel hint="Auto-pauses the agent when cumulative daily P&L reaches this loss threshold.">Max daily loss (USD)</FieldLabel>
              <input type="number" min="1" step="1" placeholder="e.g. 50"
                {...register('maxDailyLossUsd', { setValueAs: v => v === '' || v == null ? undefined : Number(v) })} />
            </div>
            <div>
              <FieldLabel hint="Auto-pauses when equity drops this % below the session peak — protects against runaway drawdowns.">Max drawdown (%)</FieldLabel>
              <input type="number" min="1" max="100" step="0.5" placeholder="e.g. 5"
                {...register('maxDrawdownPercent', { setValueAs: v => v === '' || v == null ? undefined : Number(v) })} />
            </div>
          </div>
        </ConfigSection>

        {/* ── AI Model ── */}
        <ConfigSection title="AI Model">
          <div className="space-y-4">
            <div>
              <FieldLabel hint="Which LLM provider to use for this agent's reasoning. Anthropic is the default; OpenRouter gives access to 300+ models; Ollama runs locally.">Provider</FieldLabel>
              <select {...register('llmProvider')}>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openrouter">OpenRouter</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>

            {llmProvider === 'openrouter' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <FieldLabel>OpenRouter Model</FieldLabel>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${!showFreeOnly ? 'text-text' : 'text-muted'}`}>Paid</span>
                    <button type="button" role="switch" aria-checked={showFreeOnly}
                      onClick={() => setShowFreeOnly(!showFreeOnly)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showFreeOnly ? 'bg-green' : 'bg-border'}`}>
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${showFreeOnly ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                    </button>
                    <span className={`text-xs font-medium ${showFreeOnly ? 'text-green' : 'text-muted'}`}>Free</span>
                  </div>
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
                        .filter(m => { const cost = parseFloat(m.promptCost ?? '1'); return showFreeOnly ? cost === 0 : cost > 0 })
                        .map(m => {
                          const inputCost = parseFloat(m.promptCost ?? '0')
                          const outputCost = parseFloat(m.completionCost ?? '0')
                          const isFree = inputCost === 0 && outputCost === 0
                          const costLabel = isFree ? 'FREE' : `$${(inputCost * 1e6).toFixed(2)}/$${(outputCost * 1e6).toFixed(2)} per M`
                          return <option key={m.id} value={m.id}>{m.name} · {(m.contextLength / 1000).toFixed(0)}k · {costLabel}</option>
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

            {llmProvider === 'ollama' && (
              <div>
                <FieldLabel>Local Model</FieldLabel>
                {olLoading ? (
                  <p className="text-sm text-muted py-2">Loading models…</p>
                ) : olError ? (
                  <p className="text-sm text-red py-2">{olError}</p>
                ) : (
                  <>
                    <select {...register('llmModel')} className="mt-2">
                      <option value="">— Select model —</option>
                      {olModels.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name}{m.size ? ` · ${m.size}` : ''}{m.family ? ` · ${m.family}` : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-amber-400 mt-1">
                      Not all local models support tool calling. Models without tool support will fail during agent cycles.
                    </p>
                  </>
                )}
                {agent.config.llmModel && (
                  <p className="text-xs text-muted mt-1.5">Current: <span className="font-mono text-text">{agent.config.llmModel}</span></p>
                )}
              </div>
            )}
          </div>
        </ConfigSection>

        {/* ── Custom Instructions ── */}
        <ConfigSection title="Custom Instructions">
          <FieldLabel hint="Additional instructions appended to the system prompt every tick. Use for agent-specific personality, trading biases, or supplementary rules that don't fit the strategy document.">Prompt append</FieldLabel>
          <textarea {...register('customPrompt')}
            placeholder="Additional instructions appended to the system prompt..."
            rows={5} className="font-mono text-xs" />
        </ConfigSection>

      </fieldset>

      {/* ── Indicators ── */}
      <div className="bg-surface2 border border-border/70 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/70 bg-surface">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Indicators</span>
        </div>
        <div className="p-4">
          <IndicatorConfigEditor value={indicatorConfig} onChange={setIndicatorConfig} disabled={isRunning || saving} />
        </div>
      </div>

      {/* ── Candle Data ── */}
      <div className="bg-surface2 border border-border/70 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/70 bg-surface">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Candle Data</span>
        </div>
        <div className="p-4">
          <CandleConfigEditor value={candleConfig} onChange={setCandleConfig} disabled={isRunning || saving} />
        </div>
      </div>

      {/* ── Market Context ── */}
      <div className="bg-surface2 border border-border/70 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/70 bg-surface">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Market Context</span>
        </div>
        <div className="p-4">
          <ContextConfigEditor value={contextConfig} onChange={setContextConfig} market={agent.config.market} disabled={isRunning || saving} />
        </div>
      </div>

      {/* ── Enhanced Monte Carlo ── */}
      <div className="bg-surface2 border border-border/70 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/70 bg-surface flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Enhanced Monte Carlo</span>
          <span className="text-xs text-muted/60 font-mono">
            {Object.values(mcEnhancements).filter(Boolean).length} / {Object.keys(mcEnhancements).length} active
          </span>
        </div>
        <div className="p-4 space-y-2">
          <p className="text-xs text-muted/70 mb-3">
            Additional analytical layers injected into the MC context on every tick.
            All computations are local — no extra LLM calls.
          </p>
          {(Object.keys(MC_ENHANCEMENT_LABELS) as Array<keyof MCEnhancements>).map(key => {
            const meta    = MC_ENHANCEMENT_LABELS[key]
            const enabled = mcEnhancements[key]
            return (
              <div key={key}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer select-none
                  ${enabled
                    ? 'border-accent/40 bg-accent-dim/20'
                    : 'border-border/40 hover:border-border'
                  }
                  ${(isRunning || saving) ? 'opacity-50 pointer-events-none' : ''}`}
                onClick={() => !isRunning && !saving && setMcEnhancements(prev => ({ ...prev, [key]: !prev[key] }))}
              >
                <div className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors
                  ${enabled ? 'bg-accent border-accent' : 'border-border/60'}`}>
                  {enabled && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${enabled ? 'text-accent' : 'text-text'}`}>
                      {meta.label}
                    </span>
                    {enabled && (
                      <span className="text-[10px] font-mono uppercase tracking-wide text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded">
                        ON
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted/70 mt-0.5 leading-relaxed">{meta.description}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Save / Delete */}
      <div className="flex items-center justify-between pt-1">
        <button type="submit" disabled={isRunning || saving}
          className="px-5 py-2 text-sm border border-green text-green rounded-lg hover:bg-green-dim disabled:opacity-40 transition-colors font-medium">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button type="button" disabled={deleting} onClick={handleDelete}
          className={`text-sm transition-colors ${confirmDelete ? 'text-red border border-red/30 rounded-lg px-4 py-2 hover:bg-red-dim' : 'text-muted hover:text-red'}`}>
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
