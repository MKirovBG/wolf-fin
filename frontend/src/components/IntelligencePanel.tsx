import { useEffect, useState, useCallback } from 'react'
import {
  getAgentStrategy, saveAgentStrategy, deleteAgentStrategy,
  getAgentMemories, deleteAgentMemory, clearAgentMemories,
  getAgentPlan, triggerPlanningCycle,
} from '../api/client.ts'
import type { StrategyDoc, AgentMemory, AgentPlan } from '../types/index.ts'

interface Props {
  agentKey: string
}

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`
  return `${Math.floor(d / 86400000)}d ago`
}

function confidenceBadge(c: number) {
  if (c >= 0.7) return 'bg-green/10 text-green border border-green/20'
  if (c >= 0.4) return 'bg-yellow/10 text-yellow border border-yellow/20'
  return 'bg-red/10 text-red border border-red/20'
}

function biasBadge(bias: string) {
  switch (bias) {
    case 'bullish': return 'bg-green/10 text-green border border-green/20'
    case 'bearish': return 'bg-red/10 text-red border border-red/20'
    case 'range': return 'bg-yellow/10 text-yellow border border-yellow/20'
    default: return 'bg-surface2 text-muted border border-border'
  }
}

// ── Strategy Section ──────────────────────────────────────────────────────────

const STYLES = ['scalping', 'swing', 'trend', 'mean_reversion', 'custom'] as const
const BIAS_OPTIONS = ['', 'bullish', 'bearish', 'neutral', 'range_bound', 'trend_following', 'counter_trend']
const TIMEFRAMES = ['', 'M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1']

type StrategyForm = Omit<StrategyDoc, 'agentKey' | 'createdAt' | 'updatedAt'>

const EMPTY_FORM: StrategyForm = {
  name: '', style: 'custom', bias: '', timeframe: '', entryRules: '',
  exitRules: '', filters: '', maxPositions: 1, notes: '',
}

function StrategySection({ agentKey }: { agentKey: string }) {
  const [strategy, setStrategy] = useState<StrategyDoc | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<StrategyForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const s = await getAgentStrategy(agentKey)
      // Empty object means no strategy
      if (s && (s as { agentKey?: string }).agentKey) {
        setStrategy(s as StrategyDoc)
      } else {
        setStrategy(null)
      }
    } catch { setStrategy(null) }
  }, [agentKey])

  useEffect(() => { load() }, [load])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const startEdit = () => {
    setForm(strategy
      ? { name: strategy.name, style: strategy.style, bias: strategy.bias ?? '', timeframe: strategy.timeframe ?? '', entryRules: strategy.entryRules, exitRules: strategy.exitRules, filters: strategy.filters ?? '', maxPositions: strategy.maxPositions, notes: strategy.notes ?? '' }
      : EMPTY_FORM)
    setEditing(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.entryRules.trim() || !form.exitRules.trim()) return
    setSaving(true)
    try {
      await saveAgentStrategy(agentKey, {
        ...form,
        bias: form.bias || undefined,
        timeframe: form.timeframe || undefined,
        filters: form.filters || undefined,
        notes: form.notes || undefined,
      })
      await load()
      setEditing(false)
      showToast('Strategy saved')
    } catch { showToast('Save failed') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this strategy?')) return
    try {
      await deleteAgentStrategy(agentKey)
      setStrategy(null)
      setEditing(false)
      showToast('Strategy deleted')
    } catch { showToast('Delete failed') }
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface2">
        <div>
          <span className="text-sm font-semibold text-text">Trading Strategy</span>
          {strategy && <span className="ml-2 text-xs text-muted">— {strategy.name}</span>}
        </div>
        <div className="flex gap-2">
          {strategy && !editing && (
            <button
              onClick={handleDelete}
              className="px-2.5 py-1 text-xs border border-red/30 text-red rounded hover:bg-red/10 transition-colors"
            >
              Delete
            </button>
          )}
          {!editing && (
            <button
              onClick={startEdit}
              className="px-2.5 py-1 text-xs border border-border text-muted rounded hover:border-muted2 hover:text-text transition-colors"
            >
              {strategy ? 'Edit' : 'Configure'}
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={() => setEditing(false)}
                className="px-2.5 py-1 text-xs border border-border text-muted rounded hover:border-muted2 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={saving || !form.name.trim()}
                onClick={handleSave}
                className="px-2.5 py-1 text-xs border border-green/40 text-green rounded hover:bg-green/10 disabled:opacity-40 transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className="px-4 py-2 text-xs bg-green/10 text-green border-b border-green/20">{toast}</div>
      )}

      <div className="p-4">
        {!strategy && !editing && (
          <p className="text-sm text-muted">No strategy configured. Click Configure to set up entry/exit rules that will be injected into the agent's system prompt each cycle.</p>
        )}

        {strategy && !editing && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-0.5 text-xs rounded bg-surface2 border border-border text-muted">{strategy.style.replace('_', ' ').toUpperCase()}</span>
              {strategy.timeframe && <span className="px-2 py-0.5 text-xs rounded bg-surface2 border border-border text-muted">{strategy.timeframe}</span>}
              {strategy.bias && <span className="px-2 py-0.5 text-xs rounded bg-surface2 border border-border text-muted">{strategy.bias.replace('_', ' ')}</span>}
              <span className="px-2 py-0.5 text-xs rounded bg-surface2 border border-border text-muted">Max {strategy.maxPositions} pos</span>
            </div>
            <div>
              <div className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Entry Rules</div>
              <pre className="text-xs text-text bg-bg rounded p-3 whitespace-pre-wrap break-words font-mono leading-relaxed">{strategy.entryRules}</pre>
            </div>
            <div>
              <div className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Exit Rules</div>
              <pre className="text-xs text-text bg-bg rounded p-3 whitespace-pre-wrap break-words font-mono leading-relaxed">{strategy.exitRules}</pre>
            </div>
            {strategy.filters && (
              <div>
                <div className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Filters</div>
                <pre className="text-xs text-muted bg-bg rounded p-3 whitespace-pre-wrap break-words font-mono leading-relaxed">{strategy.filters}</pre>
              </div>
            )}
            {strategy.notes && (
              <div>
                <div className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Notes</div>
                <p className="text-xs text-muted">{strategy.notes}</p>
              </div>
            )}
          </div>
        )}

        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. EMA Crossover Scalp"
                  className="text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-1">Style *</label>
                <select value={form.style} onChange={e => setForm(f => ({ ...f, style: e.target.value as StrategyForm['style'] }))} className="text-sm">
                  {STYLES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-1">Bias</label>
                <select value={form.bias ?? ''} onChange={e => setForm(f => ({ ...f, bias: e.target.value }))} className="text-sm">
                  {BIAS_OPTIONS.map(b => <option key={b} value={b}>{b || '— none —'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-1">Timeframe</label>
                <select value={form.timeframe ?? ''} onChange={e => setForm(f => ({ ...f, timeframe: e.target.value }))} className="text-sm">
                  {TIMEFRAMES.map(t => <option key={t} value={t}>{t || '— none —'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-1">Max Positions</label>
                <input
                  type="number"
                  min={1} max={10}
                  value={form.maxPositions}
                  onChange={e => setForm(f => ({ ...f, maxPositions: parseInt(e.target.value) || 1 }))}
                  className="text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-1">Entry Rules *</label>
              <textarea
                value={form.entryRules}
                onChange={e => setForm(f => ({ ...f, entryRules: e.target.value }))}
                placeholder="Describe your entry conditions in plain text..."
                rows={4}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-1">Exit Rules *</label>
              <textarea
                value={form.exitRules}
                onChange={e => setForm(f => ({ ...f, exitRules: e.target.value }))}
                placeholder="Describe your exit conditions (TP, SL, trailing stop, time-based)..."
                rows={4}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-1">Filters</label>
              <textarea
                value={form.filters ?? ''}
                onChange={e => setForm(f => ({ ...f, filters: e.target.value }))}
                placeholder="Optional: conditions that must be true before entering (e.g. session, spread, news filter)..."
                rows={3}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-1">Notes</label>
              <textarea
                value={form.notes ?? ''}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any additional notes or context for the agent..."
                rows={2}
                className="font-mono text-xs"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Session Plan Section ──────────────────────────────────────────────────────

function PlanSection({ agentKey }: { agentKey: string }) {
  const [plan, setPlan] = useState<AgentPlan | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const p = await getAgentPlan(agentKey)
      if (p && (p as { id?: number }).id) {
        setPlan(p as AgentPlan)
      } else {
        setPlan(null)
      }
    } catch { setPlan(null) }
  }, [agentKey])

  useEffect(() => { load() }, [load])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const handleTrigger = async () => {
    setTriggering(true)
    try {
      await triggerPlanningCycle(agentKey)
      showToast('Planning cycle triggered — check Logs tab')
      setTimeout(() => load(), 5000)
    } catch { showToast('Failed to trigger planning cycle') }
    finally { setTriggering(false) }
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface2">
        <div>
          <span className="text-sm font-semibold text-text">Session Plan</span>
          {plan && <span className="ml-2 text-xs text-muted">— {plan.sessionDate}</span>}
        </div>
        <button
          disabled={triggering}
          onClick={handleTrigger}
          className="px-2.5 py-1 text-xs border border-blue/30 text-blue rounded hover:bg-blue/10 disabled:opacity-40 transition-colors"
        >
          {triggering ? 'Triggering…' : 'Run Planning Cycle'}
        </button>
      </div>

      {toast && (
        <div className="px-4 py-2 text-xs bg-blue/10 text-blue border-b border-blue/20">{toast}</div>
      )}

      <div className="p-4">
        {!plan ? (
          <p className="text-sm text-muted">No active plan for today. Run a planning cycle to have the agent analyze the market and write a session plan.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2.5 py-1 text-xs font-semibold rounded border ${biasBadge(plan.marketBias)}`}>
                {plan.marketBias.toUpperCase()}
              </span>
              {plan.sessionLabel && (
                <span className="px-2 py-0.5 text-xs rounded bg-surface2 border border-border text-muted">{plan.sessionLabel}</span>
              )}
              <span className="text-xs text-muted">Created {rel(plan.createdAt)}</span>
              {plan.cycleCountAt !== undefined && (
                <span className="text-xs text-muted">at cycle #{plan.cycleCountAt}</span>
              )}
            </div>

            {plan.keyLevels && (
              <div>
                <div className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Key Levels</div>
                <pre className="text-xs text-text bg-bg rounded p-3 whitespace-pre-wrap break-words font-mono leading-relaxed">{plan.keyLevels}</pre>
              </div>
            )}

            {plan.riskNotes && (
              <div>
                <div className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Risk Notes</div>
                <p className="text-xs text-yellow bg-yellow/5 border border-yellow/20 rounded p-2">{plan.riskNotes}</p>
              </div>
            )}

            <div>
              <div className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Plan</div>
              <pre className="text-xs text-text bg-bg rounded p-3 whitespace-pre-wrap break-words font-mono leading-relaxed">{plan.planText}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Memory Section ────────────────────────────────────────────────────────────

function MemorySection({ agentKey }: { agentKey: string }) {
  const [memories, setMemories] = useState<AgentMemory[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const mems = await getAgentMemories(agentKey)
      setMemories(Array.isArray(mems) ? mems : [])
    } catch { setMemories([]) }
    finally { setLoading(false) }
  }, [agentKey])

  useEffect(() => { load() }, [load])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const handleDelete = async (category: string, key: string) => {
    try {
      await deleteAgentMemory(agentKey, category, key)
      setMemories(m => m.filter(x => !(x.category === category && x.key === key)))
      showToast('Memory deleted')
    } catch { showToast('Delete failed') }
  }

  const handleClearAll = async () => {
    if (!confirm('Clear all memories for this agent?')) return
    try {
      await clearAgentMemories(agentKey)
      setMemories([])
      showToast('All memories cleared')
    } catch { showToast('Clear failed') }
  }

  // Group by category
  const grouped = memories.reduce((acc, m) => {
    if (!acc[m.category]) acc[m.category] = []
    acc[m.category].push(m)
    return acc
  }, {} as Record<string, AgentMemory[]>)

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface2">
        <div>
          <span className="text-sm font-semibold text-text">Persistent Memory</span>
          {memories.length > 0 && <span className="ml-2 text-xs text-muted">— {memories.length} entries</span>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-2.5 py-1 text-xs border border-border text-muted rounded hover:border-muted2 transition-colors"
          >
            Refresh
          </button>
          {memories.length > 0 && (
            <button
              onClick={handleClearAll}
              className="px-2.5 py-1 text-xs border border-red/30 text-red rounded hover:bg-red/10 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div className="px-4 py-2 text-xs bg-green/10 text-green border-b border-green/20">{toast}</div>
      )}

      <div className="p-4">
        {loading && (
          <p className="text-sm text-muted">Loading memories...</p>
        )}

        {!loading && memories.length === 0 && (
          <p className="text-sm text-muted">No memories saved yet. The agent will use save_memory to record observations across cycles.</p>
        )}

        {!loading && memories.length > 0 && (
          <div className="space-y-4">
            {Object.entries(grouped).map(([category, mems]) => (
              <div key={category}>
                <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  {category.replace('_', ' ')} <span className="text-muted2 normal-case font-normal">({mems.length})</span>
                </div>
                <div className="space-y-2">
                  {mems.map(m => (
                    <div key={`${m.category}:${m.key}`} className="flex items-start gap-3 bg-bg rounded-lg p-3 border border-border">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-semibold text-text">{m.key}</span>
                          <span className={`px-1.5 py-0.5 text-xs rounded ${confidenceBadge(m.confidence)}`}>
                            {(m.confidence * 100).toFixed(0)}%
                          </span>
                          <span className="text-xs text-muted2">{rel(m.updatedAt)}</span>
                          {m.expiresAt && (
                            <span className="text-xs text-yellow">expires {rel(m.expiresAt)}</span>
                          )}
                        </div>
                        <p className="text-xs text-muted leading-relaxed">{m.value}</p>
                      </div>
                      <button
                        onClick={() => handleDelete(m.category, m.key)}
                        className="shrink-0 w-5 h-5 text-muted2 hover:text-red transition-colors text-sm leading-none"
                        title="Delete memory"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── IntelligencePanel ─────────────────────────────────────────────────────────

export function IntelligencePanel({ agentKey }: Props) {
  return (
    <div className="flex flex-col gap-5 max-w-4xl mx-auto w-full">
      <StrategySection agentKey={agentKey} />
      <PlanSection agentKey={agentKey} />
      <MemorySection agentKey={agentKey} />
    </div>
  )
}
