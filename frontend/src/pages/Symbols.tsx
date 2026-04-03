import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  getSymbols, addSymbol, deleteSymbol, updateSymbol,
  triggerAnalysis, isRunning, getMt5Accounts, searchSymbols,
} from '../api/client.ts'
import type { WatchSymbol, Mt5AccountInfo, IndicatorConfig, CandleConfig } from '../types/index.ts'
import { useToast } from '../components/Toast.tsx'
import { Card } from '../components/Card.tsx'

const TF_LABELS: Record<string, string> = {
  m1: '1m', m5: '5m', m15: '15m', m30: '30m', h1: '1H', h4: '4H',
}

const INTERVAL_OPTIONS = [
  { label: '15 min',  value: 15 * 60 * 1000 },
  { label: '30 min',  value: 30 * 60 * 1000 },
  { label: '1 hour',  value: 60 * 60 * 1000 },
  { label: '4 hours', value: 4 * 60 * 60 * 1000 },
  { label: '8 hours', value: 8 * 60 * 60 * 1000 },
]

// ── Symbol search input ───────────────────────────────────────────────────────

function SymbolSearch({ accountId, onSelect }: {
  accountId?: number
  onSelect: (sym: string) => void
}) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<Array<{ symbol: string; description: string }>>([])
  const [open, setOpen]       = useState(false)
  const debRef                = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef          = useRef<HTMLDivElement>(null)

  const search = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); return }
    try {
      const r = await searchSymbols(q, accountId)
      setResults(r.slice(0, 10))
      setOpen(true)
    } catch { setResults([]) }
  }, [accountId])

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current)
    debRef.current = setTimeout(() => search(query), 250)
  }, [query, search])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search symbol (e.g. XAUUSD, EURUSD)…"
        className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text placeholder-muted2 focus:outline-none focus:border-green"
      />
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto">
          {results.map(r => (
            <button
              key={r.symbol}
              onClick={() => { onSelect(r.symbol); setQuery(r.symbol); setOpen(false) }}
              className="w-full px-3 py-2 text-left text-xs hover:bg-surface2 transition-colors border-b border-border last:border-0"
            >
              <span className="font-mono text-text mr-2">{r.symbol}</span>
              <span className="text-muted2">{r.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const LLM_PROVIDERS: Array<{ value: string; label: string }> = [
  { value: '',                       label: 'Platform default' },
  { value: 'anthropic',              label: 'Anthropic API' },
  { value: 'anthropic-subscription', label: 'Claude (subscription)' },
  { value: 'openrouter',             label: 'OpenRouter' },
  { value: 'ollama',                 label: 'Ollama' },
  { value: 'openai-subscription',    label: 'OpenAI (subscription)' },
]

const INDICATOR_TOGGLES: Array<[keyof IndicatorConfig, string]> = [
  ['rsiEnabled',      'RSI'],
  ['atrEnabled',      'ATR'],
  ['macdEnabled',     'MACD'],
  ['emaFastEnabled',  'EMA Fast'],
  ['emaSlowEnabled',  'EMA Slow'],
  ['bbEnabled',       'Bollinger Bands'],
  ['adxEnabled',      'ADX'],
  ['vwapEnabled',     'VWAP'],
  ['mtfEnabled',      'Multi-TF'],
  ['stochEnabled',    'Stochastic'],
  ['psarEnabled',     'Parabolic SAR'],
  ['ichimokuEnabled', 'Ichimoku'],
  ['cciEnabled',      'CCI'],
  ['williamsREnabled','Williams %R'],
  ['obvEnabled',      'OBV'],
  ['mfiEnabled',      'MFI'],
  ['keltnerEnabled',   'Keltner'],
  ['divergenceEnabled','Divergence'],
  ['fibEnabled',       'Fibonacci'],
  ['patternsEnabled',  'Patterns'],
]

// ── Edit symbol modal ─────────────────────────────────────────────────────────

function EditSymbolModal({ sym, onClose, onSaved }: {
  sym: WatchSymbol
  onClose: () => void
  onSaved: () => void
}) {
  const [tf, setTf]               = useState<string>(sym.candleConfig?.primaryTimeframe ?? 'h1')
  const [schedule, setSchedule]   = useState(sym.scheduleEnabled)
  const [interval, setIntervalMs] = useState(sym.scheduleIntervalMs ?? INTERVAL_OPTIONS[2].value)
  const [startUtc, setStartUtc]   = useState(sym.scheduleStartUtc ?? '')
  const [endUtc, setEndUtc]       = useState(sym.scheduleEndUtc ?? '')
  const [llmProvider, setLlmProvider] = useState(sym.llmProvider ?? '')
  const [llmModel, setLlmModel]   = useState(sym.llmModel ?? '')
  const [indicators, setIndicators] = useState<IndicatorConfig>(sym.indicatorConfig ?? {})
  const [saving, setSaving]       = useState(false)
  const toast                     = useToast()

  const toggleIndicator = (key: keyof IndicatorConfig) => {
    setIndicators(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const patch: Partial<WatchSymbol> = {
        candleConfig:       { ...(sym.candleConfig ?? {}), primaryTimeframe: tf as CandleConfig['primaryTimeframe'] },
        scheduleEnabled:    schedule,
        scheduleIntervalMs: schedule ? interval : undefined,
        scheduleStartUtc:   schedule && startUtc ? startUtc : undefined,
        scheduleEndUtc:     schedule && endUtc   ? endUtc   : undefined,
        llmProvider:        llmProvider ? llmProvider as WatchSymbol['llmProvider'] : undefined,
        llmModel:           llmModel || undefined,
        indicatorConfig:    Object.keys(indicators).length > 0 ? indicators : undefined,
      }
      await updateSymbol(sym.key, patch)
      toast.success('Settings saved')
      onSaved()
      onClose()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <div className="font-mono font-bold text-text">{sym.symbol}</div>
            <div className="text-xs text-muted mt-0.5">Edit symbol settings</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text transition-colors text-lg leading-none">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Timeframe + Auto-Analysis */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted uppercase tracking-wider block mb-2">Primary Timeframe</label>
              <select
                value={tf}
                onChange={e => setTf(e.target.value)}
                className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-green"
              >
                {Object.entries(TF_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted uppercase tracking-wider block mb-2">Auto-Analysis</label>
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={schedule}
                  onChange={e => setSchedule(e.target.checked)}
                  className="accent-green"
                />
                <span className="text-sm text-text">Enabled</span>
              </label>
              {schedule && (
                <select
                  value={interval}
                  onChange={e => setIntervalMs(Number(e.target.value))}
                  className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-green"
                >
                  {INTERVAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Schedule window */}
          {schedule && (
            <div>
              <label className="text-xs text-muted uppercase tracking-wider block mb-1">
                Schedule Window (UTC) <span className="normal-case text-muted2">— leave blank for 24h</span>
              </label>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="text-[10px] text-muted2 block mb-1">Start</label>
                  <input
                    type="time"
                    value={startUtc}
                    onChange={e => setStartUtc(e.target.value)}
                    className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-green"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted2 block mb-1">End</label>
                  <input
                    type="time"
                    value={endUtc}
                    onChange={e => setEndUtc(e.target.value)}
                    className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-green"
                  />
                </div>
              </div>
            </div>
          )}

          {/* LLM override */}
          <div>
            <label className="text-xs text-muted uppercase tracking-wider block mb-2">LLM Override</label>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={llmProvider}
                onChange={e => setLlmProvider(e.target.value)}
                className="bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-green"
              >
                {LLM_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <input
                type="text"
                value={llmModel}
                onChange={e => setLlmModel(e.target.value)}
                placeholder="Model (blank = default)"
                className="bg-bg border border-border rounded px-3 py-2 text-sm text-text placeholder-muted2 focus:outline-none focus:border-green"
              />
            </div>
          </div>

          {/* Indicator config */}
          <div>
            <label className="text-xs text-muted uppercase tracking-wider block mb-2">Indicators</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {INDICATOR_TOGGLES.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={!!indicators[key]}
                    onChange={() => toggleIndicator(key)}
                    className="accent-green"
                  />
                  <span className="text-xs text-text">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted border border-border rounded hover:border-muted2 hover:text-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-green text-bg text-sm font-semibold rounded hover:bg-green/90 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add symbol form ───────────────────────────────────────────────────────────

function AddSymbolForm({ accounts, onAdded }: {
  accounts: Mt5AccountInfo[]
  onAdded: () => void
}) {
  const [symbol, setSymbol]         = useState('')
  const [accountId, setAccountId]   = useState<number | undefined>(
    accounts.find(a => a.active)?.login
  )
  const [tf, setTf]                 = useState<string>('h1')
  const [schedule, setSchedule]     = useState(false)
  const [interval, setInterval]     = useState(INTERVAL_OPTIONS[2].value)
  const [submitting, setSubmitting] = useState(false)
  const toast                       = useToast()

  const submit = async () => {
    if (!symbol) return
    setSubmitting(true)
    try {
      await addSymbol({
        symbol,
        mt5AccountId: accountId,
        candleConfig: { primaryTimeframe: tf as WatchSymbol['candleConfig'] extends infer C ? (C extends { primaryTimeframe?: infer T } ? T : never) : never },
        scheduleEnabled: schedule,
        scheduleIntervalMs: schedule ? interval : undefined,
      })
      toast.success(`${symbol} added to watchlist`)
      setSymbol('')
      onAdded()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">Add Symbol</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-muted uppercase tracking-wider block mb-2">Symbol</label>
          <SymbolSearch accountId={accountId} onSelect={setSymbol} />
        </div>
        <div>
          <label className="text-xs text-muted uppercase tracking-wider block mb-2">MT5 Account</label>
          <select
            value={accountId ?? ''}
            onChange={e => setAccountId(e.target.value ? Number(e.target.value) : undefined)}
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-green"
          >
            <option value="">Any account</option>
            {accounts.map(a => (
              <option key={a.login} value={a.login}>
                #{a.login}{a.name ? ` · ${a.name}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted uppercase tracking-wider block mb-2">Primary Timeframe</label>
          <select
            value={tf}
            onChange={e => setTf(e.target.value)}
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-green"
          >
            {Object.entries(TF_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted uppercase tracking-wider block mb-2">Auto-Analysis</label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={schedule}
                onChange={e => setSchedule(e.target.checked)}
                className="accent-green"
              />
              <span className="text-sm text-text">Enabled</span>
            </label>
            {schedule && (
              <select
                value={interval}
                onChange={e => setInterval(Number(e.target.value))}
                className="bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:outline-none focus:border-green"
              >
                {INTERVAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={submit}
        disabled={!symbol || submitting}
        className="px-4 py-2 bg-green text-bg text-sm font-semibold rounded hover:bg-green/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? 'Adding…' : 'Add to Watchlist'}
      </button>
    </div>
  )
}

// ── Symbol card ───────────────────────────────────────────────────────────────

function SymbolCard({ sym, onDelete, onAnalyze }: {
  sym: WatchSymbol
  onDelete: (key: string) => void
  onAnalyze: (key: string) => void
}) {
  const [running, setRunning] = useState(false)
  const tf = sym.candleConfig?.primaryTimeframe ?? 'h1'

  const handleAnalyze = async () => {
    setRunning(true)
    try {
      await onAnalyze(sym.key)
    } finally {
      // Poll for completion
      const poll = setInterval(async () => {
        try {
          const r = await isRunning(sym.key)
          if (!r.running) { setRunning(false); clearInterval(poll) }
        } catch { setRunning(false); clearInterval(poll) }
      }, 2000)
    }
  }

  const biasColor = sym.lastAnalysisAt ? 'text-muted' : 'text-muted2'
  const lastTime  = sym.lastAnalysisAt
    ? new Date(sym.lastAnalysisAt).toLocaleString()
    : 'Never analyzed'

  return (
    <div className="bg-surface border border-border rounded-lg p-4 hover:border-muted2 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <Link
            to={`/symbols/${encodeURIComponent(sym.key)}`}
            className="font-mono text-base font-bold text-text hover:text-green transition-colors"
          >
            {sym.symbol}
          </Link>
          {sym.displayName && (
            <span className="ml-2 text-xs text-muted2">{sym.displayName}</span>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[10px] font-mono bg-bg border border-border rounded px-1.5 py-0.5 text-muted">
              {TF_LABELS[tf] ?? tf}
            </span>
            {sym.mt5AccountId && (
              <span className="text-[10px] text-muted2">#{sym.mt5AccountId}</span>
            )}
            {sym.scheduleEnabled && sym.scheduleIntervalMs && (
              <span className="text-[10px] text-green/70 flex items-center gap-1">
                ⏱ {INTERVAL_OPTIONS.find(o => o.value === sym.scheduleIntervalMs)?.label ?? 'Auto'}
              </span>
            )}
          </div>
          <div className={`text-[11px] mt-2 ${biasColor}`}>{lastTime}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleAnalyze}
            disabled={running}
            className="px-3 py-1.5 bg-green/10 text-green text-xs font-medium rounded border border-green/30 hover:bg-green/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {running ? (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green animate-pulse" />
                Running…
              </span>
            ) : 'Analyze'}
          </button>
          <Link
            to={`/symbols/${encodeURIComponent(sym.key)}`}
            className="px-3 py-1.5 bg-surface2 text-muted text-xs rounded border border-border hover:text-text hover:border-muted2 transition-colors"
          >
            View
          </Link>
          <Link
            to={`/symbols/${encodeURIComponent(sym.key)}/config`}
            className="px-2 py-1.5 text-muted hover:text-text transition-colors text-xs"
            title="Configure symbol"
          >
            ✎
          </Link>
          <button
            onClick={() => onDelete(sym.key)}
            className="px-2 py-1.5 text-muted hover:text-red transition-colors text-xs"
            title="Remove from watchlist"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Symbols() {
  const [symbols, setSymbols]   = useState<WatchSymbol[]>([])
  const [accounts, setAccounts] = useState<Mt5AccountInfo[]>([])
  const [showAdd, setShowAdd]   = useState(false)
  const toast                   = useToast()

  const load = useCallback(async () => {
    try {
      const [syms, accts] = await Promise.all([getSymbols(), getMt5Accounts()])
      setSymbols(syms)
      setAccounts(accts)
    } catch (e) { toast.error(String(e)) }
  }, [toast])

  useEffect(() => { load() }, [load])

  const handleDelete = async (key: string) => {
    const sym = symbols.find(s => s.key === key)
    if (!confirm(`Remove ${sym?.symbol ?? key} from watchlist?`)) return
    try {
      await deleteSymbol(key)
      setSymbols(prev => prev.filter(s => s.key !== key))
      toast.info('Symbol removed')
    } catch (e) { toast.error(String(e)) }
  }

  const handleAnalyze = async (key: string) => {
    try {
      await triggerAnalysis(key)
      toast.info('Analysis started')
    } catch (e) { toast.error(String(e)) }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text">Watchlist</h1>
          <p className="text-xs text-muted mt-0.5">
            {symbols.length} symbol{symbols.length !== 1 ? 's' : ''} — AI analyzes market conditions and identifies trade setups
          </p>
        </div>
        <button
          onClick={() => setShowAdd(o => !o)}
          className="px-4 py-2 bg-green text-bg text-sm font-semibold rounded hover:bg-green/90 transition-colors"
        >
          {showAdd ? 'Cancel' : '+ Add Symbol'}
        </button>
      </div>

      {showAdd && (
        <AddSymbolForm
          accounts={accounts}
          onAdded={() => { load(); setShowAdd(false) }}
        />
      )}

      {symbols.length === 0 ? (
        <Card>
          <div className="text-center py-12 text-muted">
            <div className="text-3xl mb-3">📊</div>
            <div className="font-medium text-text mb-1">No symbols yet</div>
            <div className="text-xs text-muted2">Add a symbol to start receiving AI trade analysis</div>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {symbols.map(sym => (
            <SymbolCard
              key={sym.key}
              sym={sym}
              onDelete={handleDelete}
              onAnalyze={handleAnalyze}
            />
          ))}
        </div>
      )}
    </div>
  )
}
