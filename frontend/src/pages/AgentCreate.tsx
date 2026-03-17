import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { addAgent, getMt5Accounts, getOpenRouterModels, searchSymbols } from '../api/client.ts'
import type { AgentConfig, Mt5AccountInfo, OpenRouterModel } from '../types/index.ts'

// ── Interval helpers ───────────────────────────────────────────────────────────
const INTERVALS = [2, 5, 10, 15, 20, 30, 60, 300, 900, 1800, 3600, 14400]
function intervalLabel(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${s / 60} min`
  return `${s / 3600}h`
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <div className="text-[10px] font-bold tracking-widest text-muted uppercase mb-4">{title}</div>
      {children}
    </div>
  )
}

// ── Field wrapper ──────────────────────────────────────────────────────────────
function Field({ label, children, half }: { label: string; children: React.ReactNode; half?: boolean }) {
  return (
    <div className={half ? 'col-span-1' : ''}>
      <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">{label}</label>
      {children}
    </div>
  )
}

// ── Symbol search component ────────────────────────────────────────────────────
function SymbolSearch({
  market, accountId, value, onChange,
}: {
  market: string
  accountId?: number
  value: string
  onChange: (v: string) => void
}) {
  const [query, setQuery] = useState(value)
  const [results, setResults] = useState<Array<{ symbol: string; description: string }>>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync external value → internal query
  useEffect(() => { setQuery(value) }, [value])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const doSearch = useCallback((q: string) => {
    if (!market) return
    setLoading(true)
    searchSymbols(market, q, accountId)
      .then(r => { setResults(r); setOpen(r.length > 0) })
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [market, accountId])

  const handleInput = (q: string) => {
    setQuery(q)
    onChange(q.toUpperCase().trim())
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(q), 320)
  }

  const select = (sym: string) => {
    setQuery(sym)
    onChange(sym)
    setOpen(false)
  }

  // Load initial list on market/account change
  useEffect(() => {
    if (market) doSearch(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, accountId])

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          value={query}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={market === 'mt5' ? 'Search e.g. XAU, EUR, BTC…' : market === 'crypto' ? 'Search e.g. BTC, ETH…' : 'Search e.g. EUR, GBP…'}
          className="w-full pr-8"
        />
        {loading && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted text-[10px]">…</span>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl overflow-y-auto" style={{ maxHeight: 220 }}>
          {results.map(r => (
            <button
              key={r.symbol}
              type="button"
              onClick={() => select(r.symbol)}
              className="w-full text-left px-3 py-2 hover:bg-surface2 transition-colors flex items-center justify-between group"
            >
              <span className="text-white text-xs font-mono font-bold">{r.symbol}</span>
              <span className="text-muted text-[10px] truncate ml-3 group-hover:text-muted2">{r.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export function AgentCreate() {
  const navigate = useNavigate()

  // Form state
  const [market, setMarket] = useState<'crypto' | 'forex' | 'mt5'>('crypto')
  const [symbol, setSymbol] = useState('')
  const [paper, setPaper] = useState(true)
  const [fetchMode, setFetchMode] = useState<'manual' | 'scheduled' | 'autonomous'>('scheduled')
  const [intervalSec, setIntervalSec] = useState(60)
  const [maxLossUsd, setMaxLossUsd] = useState(200)
  const [leverage, setLeverage] = useState<number | ''>('')
  const [maxIterations, setMaxIterations] = useState(10)
  const [customPrompt, setCustomPrompt] = useState('')
  const [llmProvider, setLlmProvider] = useState<'anthropic' | 'openrouter'>('anthropic')
  const [llmModel, setLlmModel] = useState('')
  const [mt5AccountId, setMt5AccountId] = useState<number | undefined>()

  // Derived / loaded state
  const [mt5Accounts, setMt5Accounts] = useState<Mt5AccountInfo[]>([])
  const [selectedAccount, setSelectedAccount] = useState<Mt5AccountInfo | null>(null)
  const [orModels, setOrModels] = useState<OpenRouterModel[]>([])
  const [orLoading, setOrLoading] = useState(false)
  const [orError, setOrError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Load MT5 accounts when market changes to mt5
  useEffect(() => {
    if (market === 'mt5') {
      getMt5Accounts().then(setMt5Accounts).catch(() => setMt5Accounts([]))
    }
  }, [market])

  // Load OpenRouter models
  useEffect(() => {
    if (llmProvider === 'openrouter') {
      setOrError(null); setOrLoading(true)
      getOpenRouterModels()
        .then(setOrModels)
        .catch(() => setOrError('Could not load models — check your OpenRouter API key'))
        .finally(() => setOrLoading(false))
    }
  }, [llmProvider])

  // Update selected account detail when accountId changes
  useEffect(() => {
    setSelectedAccount(mt5Accounts.find(a => a.login === mt5AccountId) ?? null)
  }, [mt5AccountId, mt5Accounts])

  // Reset symbol when market changes
  useEffect(() => { setSymbol('') }, [market])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!symbol) { setErr('Symbol is required'); return }
    setErr(null); setSubmitting(true)
    try {
      const config: AgentConfig = {
        symbol: symbol.toUpperCase().trim(),
        market,
        paper,
        fetchMode,
        scheduleIntervalSeconds: intervalSec,
        maxLossUsd,
        leverage: leverage !== '' ? Number(leverage) : undefined,
        maxIterations,
        customPrompt: customPrompt || undefined,
        llmProvider,
        llmModel: llmModel || undefined,
        mt5AccountId,
      }
      const res = await addAgent(config)
      if (!res.ok) { setErr('Failed to create agent'); return }
      navigate(`/agents/${market}/${symbol.toUpperCase().trim()}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link to="/agents" className="text-muted text-xs hover:text-white transition-colors">← Back to Agents</Link>
        <h1 className="text-white font-bold text-lg mt-3">New Agent</h1>
        <p className="text-muted text-xs mt-1">Configure a new autonomous trading agent</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── 1. Market & Account ──────────────────────────────────────────── */}
        <Section title="1 · Market & Broker">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Market">
              <select value={market} onChange={e => setMarket(e.target.value as typeof market)} className="w-full">
                <option value="crypto">Crypto — Binance</option>
                <option value="forex">Forex — Alpaca</option>
                <option value="mt5">MetaTrader 5</option>
              </select>
            </Field>

            <Field label="Trading Mode">
              <select value={paper ? 'true' : 'false'} onChange={e => setPaper(e.target.value === 'true')} className="w-full">
                <option value="true">Paper (simulated)</option>
                <option value="false">Live (real money)</option>
              </select>
            </Field>
          </div>

          {/* MT5 Account selector */}
          {market === 'mt5' && (
            <div className="mt-4">
              {mt5Accounts.length === 0 ? (
                <p className="text-xs text-muted py-2">No accounts found — register accounts in the MT5 bridge first.</p>
              ) : (
                <div className="grid grid-cols-2 gap-4 items-start">
                  <Field label="MT5 Account">
                    <select
                      value={mt5AccountId ?? ''}
                      onChange={e => setMt5AccountId(e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full"
                    >
                      <option value="">— Select account —</option>
                      {mt5Accounts.map(a => (
                        <option key={a.login} value={a.login}>
                          {a.name} · {a.mode} · #{a.login}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {/* Account balance — read only */}
                  {selectedAccount && (
                    <div className="bg-bg border border-border rounded-lg p-3 text-xs">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        <div className="text-muted">Balance
                          <span className="text-white font-bold ml-2">
                            {selectedAccount.balance != null ? `${selectedAccount.currency ?? 'USD'} ${selectedAccount.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
                          </span>
                        </div>
                        <div className="text-muted">Mode
                          <span className={`font-bold ml-2 ${selectedAccount.mode === 'LIVE' ? 'text-red' : 'text-yellow'}`}>
                            {selectedAccount.mode}
                          </span>
                        </div>
                        <div className="text-muted">Server
                          <span className="text-muted2 ml-2 text-[10px]">{selectedAccount.server}</span>
                        </div>
                        <div className="text-muted">Login
                          <span className="text-muted2 ml-2 text-[10px]">#{selectedAccount.login}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ── 2. Symbol ────────────────────────────────────────────────────── */}
        <Section title="2 · Symbol">
          <Field label="Search & Select Symbol">
            <SymbolSearch
              market={market}
              accountId={mt5AccountId}
              value={symbol}
              onChange={setSymbol}
            />
          </Field>
          {symbol && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] text-muted">Selected:</span>
              <span className="text-green font-mono font-bold text-xs bg-green-dim border border-green/20 px-2 py-0.5 rounded">{symbol}</span>
            </div>
          )}
        </Section>

        {/* ── 3. Schedule ──────────────────────────────────────────────────── */}
        <Section title="3 · Schedule">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Fetch Mode">
              <select value={fetchMode} onChange={e => setFetchMode(e.target.value as typeof fetchMode)} className="w-full">
                <option value="manual">Manual (trigger only)</option>
                <option value="scheduled">Scheduled</option>
                <option value="autonomous">Autonomous (market-aware)</option>
              </select>
            </Field>

            {fetchMode !== 'manual' && (
              <Field label="Cycle Interval">
                <select value={intervalSec} onChange={e => setIntervalSec(Number(e.target.value))} className="w-full">
                  {INTERVALS.map(s => <option key={s} value={s}>{intervalLabel(s)}</option>)}
                </select>
              </Field>
            )}
          </div>
        </Section>

        {/* ── 4. Risk & Sizing ─────────────────────────────────────────────── */}
        <Section title="4 · Risk & Sizing">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Max Daily Loss $">
              <input
                type="number"
                min="1"
                value={maxLossUsd}
                onChange={e => setMaxLossUsd(Number(e.target.value))}
                className="w-full"
              />
            </Field>

            <Field label="Leverage">
              <input
                type="number"
                min="1"
                max="3000"
                placeholder="e.g. 100"
                value={leverage}
                onChange={e => setLeverage(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full"
              />
            </Field>

            <Field label="Max Iterations / Cycle">
              <input
                type="number"
                min="1"
                max="20"
                value={maxIterations}
                onChange={e => setMaxIterations(Number(e.target.value))}
                className="w-full"
              />
            </Field>
          </div>
          <p className="text-[10px] text-muted mt-2">
            Leverage is informational — the agent uses it for position sizing context. The global max-position guardrail is set via the <span className="text-white">MAX_POSITION_USD</span> environment variable.
          </p>
        </Section>

        {/* ── 5. AI Model ──────────────────────────────────────────────────── */}
        <Section title="5 · AI Model">
          <div className="grid grid-cols-2 gap-4">
            <Field label="LLM Provider">
              <select value={llmProvider} onChange={e => setLlmProvider(e.target.value as typeof llmProvider)} className="w-full">
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </Field>

            {llmProvider === 'openrouter' && (
              <Field label="OpenRouter Model">
                {orLoading ? (
                  <p className="text-xs text-muted py-2">Loading models…</p>
                ) : orError ? (
                  <p className="text-xs text-red py-2">{orError}</p>
                ) : (
                  <select value={llmModel} onChange={e => setLlmModel(e.target.value)} className="w-full">
                    <option value="">— Select model —</option>
                    {orModels.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name}{m.contextLength ? ` · ${(m.contextLength / 1000).toFixed(0)}k ctx` : ''}
                        {m.promptCost ? ` · $${(parseFloat(m.promptCost) * 1e6).toFixed(2)}/M` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </div>

          {/* Custom prompt */}
          <div className="mt-4">
            <label className="text-[10px] text-muted uppercase tracking-wide block mb-1.5">Custom System Prompt (optional)</label>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder="Additional instructions appended to the agent system prompt…"
              rows={5}
              style={{
                background: '#1e1e1e', border: '1px solid #2a2a2a', color: '#e0e0e0',
                borderRadius: 4, padding: '8px 10px', fontFamily: 'Courier New, monospace',
                fontSize: 11, lineHeight: '1.6', outline: 'none', width: '100%',
                resize: 'vertical', minHeight: 100,
              }}
            />
          </div>
        </Section>

        {/* ── Submit ───────────────────────────────────────────────────────── */}
        {err && <p className="text-red text-xs">{err}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting || !symbol}
            className="px-6 py-2 text-sm border border-green text-green rounded hover:bg-green-dim disabled:opacity-40 transition-colors font-medium"
          >
            {submitting ? 'Creating…' : '+ Create Agent'}
          </button>
          <Link
            to="/agents"
            className="px-6 py-2 text-sm border border-border text-muted rounded hover:border-muted hover:text-white transition-colors font-medium"
          >
            Cancel
          </Link>
        </div>

      </form>
    </div>
  )
}
