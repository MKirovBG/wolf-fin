import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { getAgents, addAgent } from '../api/client.ts'
import type { AgentState, AgentConfig } from '../types/index.ts'
import { AgentCard } from '../components/AgentCard.tsx'

const DEFAULT_CONFIG: AgentConfig = {
  symbol: '',
  market: 'crypto',
  paper: true,
  maxIterations: 10,
  fetchMode: 'scheduled',
  scheduleIntervalMinutes: 15,
  maxLossUsd: 200,
  maxPositionUsd: 1000,
  customPrompt: '',
}

const INTERVALS = [1, 5, 15, 30, 60, 240]

function AddAgentForm({ onAdded }: { onAdded: () => void }) {
  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<AgentConfig>({
    defaultValues: DEFAULT_CONFIG,
  })
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fetchMode = watch('fetchMode')

  const onSubmit = handleSubmit(async (data) => {
    setErr(null)
    setAdding(true)
    try {
      const res = await addAgent({
        ...data,
        symbol: data.symbol.toUpperCase().trim(),
        maxIterations: Number(data.maxIterations),
        scheduleIntervalMinutes: Number(data.scheduleIntervalMinutes),
        maxLossUsd: Number(data.maxLossUsd),
        maxPositionUsd: Number(data.maxPositionUsd),
      })
      if (!res.ok) { setErr((res as { message?: string }).message ?? 'Failed'); return }
      reset(DEFAULT_CONFIG)
      onAdded()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setAdding(false)
    }
  })

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* Symbol */}
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Symbol *</label>
          <input
            {...register('symbol', { required: true })}
            placeholder="BTCUSDT or EUR_USD"
            className={errors.symbol ? '!border-red' : ''}
          />
        </div>

        {/* Market */}
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Market</label>
          <select {...register('market')}>
            <option value="crypto">Crypto (Binance)</option>
            <option value="forex">Forex (Alpaca)</option>
          </select>
        </div>

        {/* Mode */}
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Trading Mode</label>
          <select {...register('paper', { setValueAs: v => v === 'true' })}>
            <option value="true">Paper (safe)</option>
            <option value="false">Live (real money)</option>
          </select>
        </div>

        {/* Fetch mode */}
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Fetch Mode</label>
          <select {...register('fetchMode')}>
            <option value="manual">Manual (trigger only)</option>
            <option value="scheduled">Scheduled (cron)</option>
            <option value="autonomous">Autonomous (smart)</option>
          </select>
        </div>

        {/* Interval */}
        {fetchMode !== 'manual' && (
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Interval</label>
            <select {...register('scheduleIntervalMinutes')}>
              {INTERVALS.map(m => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60}h`}</option>)}
            </select>
          </div>
        )}

        {/* Max Loss */}
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Max Daily Loss $</label>
          <input type="number" step="1" {...register('maxLossUsd')} />
        </div>

        {/* Max Position */}
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Max Position $</label>
          <input type="number" step="1" {...register('maxPositionUsd')} />
        </div>

        {/* Max iterations */}
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Max Iterations</label>
          <input type="number" min="1" max="20" {...register('maxIterations')} />
        </div>
      </div>

      {/* Custom prompt */}
      <div>
        <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Custom Prompt (optional)</label>
        <textarea
          {...register('customPrompt')}
          placeholder="Additional instructions appended to the system prompt..."
          rows={6}
          style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', color: '#e0e0e0', borderRadius: 4, padding: '8px 10px', fontFamily: 'Courier New, monospace', fontSize: 11, lineHeight: '1.6', outline: 'none', width: '100%', resize: 'vertical', minHeight: 100 }}
        />
      </div>

      {err && <p className="text-red text-xs">{err}</p>}

      <button
        type="submit"
        disabled={adding}
        className="px-5 py-2 text-xs border border-green text-green rounded hover:bg-green-dim disabled:opacity-40 transition-colors"
      >
        {adding ? 'Adding...' : '+ Add Agent'}
      </button>
    </form>
  )
}

export function Agents() {
  const [agents, setAgents] = useState<AgentState[]>([])
  const [showAdd, setShowAdd] = useState(false)

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
          onClick={() => setShowAdd(s => !s)}
          className={`px-4 py-2 text-xs border rounded transition-colors ${
            showAdd
              ? 'border-border text-muted hover:border-muted'
              : 'border-green text-green hover:bg-green-dim'
          }`}
        >
          {showAdd ? '✕ Cancel' : '+ New Agent'}
        </button>
      </div>

      {/* Add agent form */}
      {showAdd && (
        <div className="bg-surface border border-border rounded-lg p-5 mb-6">
          <h2 className="text-[10px] font-bold tracking-widest text-muted uppercase mb-4">Configure New Agent</h2>
          <AddAgentForm onAdded={() => { setShowAdd(false); load() }} />
        </div>
      )}

      {/* Agent cards grid */}
      {agents.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-12 text-center">
          <div className="text-4xl mb-4">🤖</div>
          <h2 className="text-white text-sm font-bold mb-2">No agents configured</h2>
          <p className="text-muted text-xs mb-4">Add an agent to start monitoring markets and trading.</p>
          <button
            onClick={() => setShowAdd(true)}
            className="px-5 py-2 text-xs border border-green text-green rounded hover:bg-green-dim transition-colors"
          >
            + Add Your First Agent
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map(agent => (
            <AgentCard
              key={`${agent.config.market}:${agent.config.symbol}`}
              agent={agent}
              onRefresh={load}
            />
          ))}
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
