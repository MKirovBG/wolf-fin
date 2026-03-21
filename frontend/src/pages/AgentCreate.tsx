import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { addAgent, getMt5Accounts, getOpenRouterModels, getOllamaModels, searchSymbols } from '../api/client.ts'
import type { AgentConfig, GuardrailsConfig, Mt5AccountInfo, OpenRouterModel, OllamaModel } from '../types/index.ts'
import { useToast } from '../components/Toast.tsx'
import { PromptEditor } from '../components/PromptEditor.tsx'
import { GuardrailsEditor } from '../components/GuardrailsEditor.tsx'
import { useAccount } from '../contexts/AccountContext.tsx'

// ── Interval helpers ───────────────────────────────────────────────────────────
const INTERVALS = [2, 5, 10, 15, 20, 30, 60, 300, 900, 1800, 3600, 14400]
function intervalLabel(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${s / 60} min`
  return `${s / 3600}h`
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">{title}</div>
      {hint && <p className="text-xs text-muted2 mb-4 leading-relaxed">{hint}</p>}
      {!hint && <div className="mb-4" />}
      {children}
    </div>
  )
}

// ── Field wrapper ──────────────────────────────────────────────────────────────
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-2">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted mt-1.5 leading-relaxed">{hint}</p>}
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

  useEffect(() => { setQuery(value) }, [value])

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
          placeholder={market === 'mt5' ? 'Search e.g. XAU, EUR, BTC…' : 'Search e.g. BTC, ETH…'}
          className="w-full pr-8"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-xs">…</span>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl overflow-y-auto" style={{ maxHeight: 220 }}>
          {results.map(r => (
            <button
              key={r.symbol}
              type="button"
              onClick={() => select(r.symbol)}
              className="w-full text-left px-3 py-2.5 hover:bg-surface2 transition-colors flex items-center justify-between"
            >
              <span className="text-text text-sm font-mono font-bold">{r.symbol}</span>
              <span className="text-muted text-xs truncate ml-3">{r.description}</span>
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
  const toast = useToast()
  const { selectedAccount } = useAccount()

  // Basic — pre-fill market + accountId from selected account
  const [agentName, setAgentName] = useState('')
  const [market, setMarket] = useState<'crypto' | 'mt5'>(
    selectedAccount?.market === 'mt5' ? 'mt5' : 'crypto'
  )
  const [symbol, setSymbol] = useState('')
  const [mt5AccountId, setMt5AccountId] = useState<number | undefined>(
    selectedAccount?.market === 'mt5' ? parseInt(selectedAccount.accountId, 10) : undefined
  )

  // Schedule
  const [fetchMode, setFetchMode] = useState<'manual' | 'scheduled' | 'autonomous'>('scheduled')
  const [intervalSec, setIntervalSec] = useState(60)

  // LLM
  const [leverage, setLeverage] = useState<number | ''>('')
  const [dailyTargetUsd, setDailyTargetUsd] = useState<number | ''>(500)
  const [maxRiskPercent, setMaxRiskPercent] = useState<number | ''>(10)
  const [maxDailyLossUsd, setMaxDailyLossUsd] = useState<number | ''>('')
  const [llmProvider, setLlmProvider] = useState<'anthropic' | 'openrouter' | 'ollama'>('anthropic')
  const [llmModel, setLlmModel] = useState('')

  // Prompt
  const [promptTemplate, setPromptTemplate] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')

  // Guardrails
  const [guardrails, setGuardrails] = useState<Partial<GuardrailsConfig>>({})

  // UI state
  const [mt5Accounts, setMt5Accounts] = useState<Mt5AccountInfo[]>([])
  const [selectedMt5Account, setSelectedMt5Account] = useState<Mt5AccountInfo | null>(null)
  const [orModels, setOrModels] = useState<OpenRouterModel[]>([])
  const [orLoading, setOrLoading] = useState(false)
  const [orError, setOrError] = useState<string | null>(null)
  const [showFreeOnly, setShowFreeOnly] = useState(false)
  const [olModels, setOlModels] = useState<OllamaModel[]>([])
  const [olLoading, setOlLoading] = useState(false)
  const [olError, setOlError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (market === 'mt5') {
      getMt5Accounts().then(setMt5Accounts).catch(() => setMt5Accounts([]))
    }
  }, [market])

  useEffect(() => {
    if (llmProvider === 'openrouter') {
      setOrError(null); setOrLoading(true)
      getOpenRouterModels()
        .then(setOrModels)
        .catch(() => setOrError('Could not load models — check your OpenRouter API key'))
        .finally(() => setOrLoading(false))
    }
    if (llmProvider === 'ollama') {
      setOlError(null); setOlLoading(true)
      getOllamaModels()
        .then(setOlModels)
        .catch(() => setOlError('Could not reach Ollama — is it running?'))
        .finally(() => setOlLoading(false))
    }
  }, [llmProvider])

  useEffect(() => {
    setSelectedMt5Account(mt5Accounts.find(a => a.login === mt5AccountId) ?? null)
  }, [mt5AccountId, mt5Accounts])

  useEffect(() => { setSymbol('') }, [market])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!symbol) { setErr('Symbol is required'); return }
    setErr(null); setSubmitting(true)
    try {
      const config: AgentConfig = {
        name: agentName.trim() || undefined,
        symbol: symbol.toUpperCase().trim(),
        market,
        fetchMode,
        scheduleIntervalSeconds: intervalSec,
        leverage: leverage !== '' ? Number(leverage) : undefined,
        dailyTargetUsd: dailyTargetUsd !== '' ? Number(dailyTargetUsd) : undefined,
        maxRiskPercent: maxRiskPercent !== '' ? Number(maxRiskPercent) : undefined,
        maxDailyLossUsd: maxDailyLossUsd !== '' ? Number(maxDailyLossUsd) : undefined,
        customPrompt: customPrompt || undefined,
        promptTemplate: promptTemplate || undefined,
        guardrails: Object.keys(guardrails).length > 0 ? guardrails : undefined,
        llmProvider,
        llmModel: llmModel || undefined,
        mt5AccountId,
      }
      const res = await addAgent(config)
      if (!res.ok) { setErr('Failed to create agent'); return }
      const conflictMsg = res.conflicts?.length
        ? ` (note: ${res.conflicts.join(', ')} also trading this symbol)`
        : ''
      toast.success(`Agent ${symbol.toUpperCase().trim()} created${conflictMsg}`)
      navigate(`/agents/k/${encodeURIComponent(res.key)}`)
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
        <Link to="/agents" className="text-sm text-muted hover:text-text transition-colors">← Back to Agents</Link>
        <h1 className="text-text font-bold text-2xl mt-3">New Agent</h1>
        <p className="text-muted text-sm mt-1">Configure a new autonomous trading agent</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── 1. Basic ────────────────────────────────────────────────────── */}
        <Section title="1 · Basic" hint="Name your agent and choose which market and symbol to trade.">
          <div className="space-y-4">
            <Field label="Agent Name (optional)" hint="Give this agent a unique name to run multiple agents on the same symbol with different strategies.">
              <input
                type="text"
                placeholder="e.g. XAUUSD Scalper, Gold Trend Follower…"
                value={agentName}
                onChange={e => setAgentName(e.target.value)}
                className="w-full"
              />
            </Field>

            <Field label="Market">
              <select value={market} onChange={e => setMarket(e.target.value as typeof market)} className="w-full">
                <option value="crypto">Crypto — Binance</option>
                <option value="mt5">MetaTrader 5</option>
              </select>
            </Field>

            {market === 'mt5' && (
              <div>
                {mt5Accounts.length === 0 ? (
                  <p className="text-sm text-muted py-2">No accounts found — register accounts in the MT5 bridge first.</p>
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

                    {selectedMt5Account && (
                      <div className="bg-bg border border-border rounded-lg p-3 text-sm">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                          <div className="text-muted">Balance
                            <span className="text-text font-medium ml-2">
                              {selectedMt5Account.balance != null
                                ? `${selectedMt5Account.currency ?? 'USD'} ${selectedMt5Account.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                                : '—'}
                            </span>
                          </div>
                          <div className="text-muted">Mode
                            <span className={`font-semibold ml-2 ${selectedMt5Account.mode === 'LIVE' ? 'text-red' : 'text-yellow'}`}>
                              {selectedMt5Account.mode}
                            </span>
                          </div>
                          <div className="text-muted">Server
                            <span className="text-muted2 ml-2 text-xs">{selectedMt5Account.server}</span>
                          </div>
                          <div className="text-muted">Login
                            <span className="text-muted2 ml-2 text-xs">#{selectedMt5Account.login}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <Field label="Symbol">
              <SymbolSearch
                market={market}
                accountId={mt5AccountId}
                value={symbol}
                onChange={setSymbol}
              />
              {symbol && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-muted">Selected:</span>
                  <span className="text-green font-mono font-bold text-sm bg-green-dim border border-green/20 px-2.5 py-0.5 rounded-lg">{symbol}</span>
                </div>
              )}
            </Field>
          </div>
        </Section>

        {/* ── 2. Schedule ──────────────────────────────────────────────────── */}
        <Section title="2 · Schedule" hint="How often the agent runs and whether it follows market session awareness.">
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

        {/* ── 3. LLM ───────────────────────────────────────────────────────── */}
        <Section title="3 · LLM" hint="Choose the AI model and configure account leverage for position sizing.">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="LLM Provider">
                <select value={llmProvider} onChange={e => setLlmProvider(e.target.value as typeof llmProvider)} className="w-full">
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="ollama">Ollama (Local)</option>
                </select>
              </Field>

              <Field label="Leverage" hint="Informational — agent uses it for margin calculation.">
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
              <Field label="Daily Target (USD)" hint="Position sized to hit this amount at TP. Default: $500.">
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 500"
                  value={dailyTargetUsd}
                  onChange={e => setDailyTargetUsd(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full"
                />
              </Field>
              <Field label="Max Risk per Trade (%)" hint="Max % of equity at risk per trade. Default: 10%.">
                <input
                  type="number"
                  min="0.5"
                  max="50"
                  step="0.5"
                  placeholder="e.g. 10"
                  value={maxRiskPercent}
                  onChange={e => setMaxRiskPercent(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full"
                />
              </Field>
              <Field label="Max Daily Loss (USD)" hint="Agent auto-pauses when today's realized P&L drops to -this amount.">
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 50"
                  value={maxDailyLossUsd}
                  onChange={e => setMaxDailyLossUsd(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full"
                />
              </Field>
            </div>

            {llmProvider === 'openrouter' && (
              <div>
                <label className="text-xs font-medium text-muted uppercase tracking-wider">OpenRouter Model</label>
                <div className="flex items-center gap-2 my-2">
                  <span className={`text-xs font-medium ${!showFreeOnly ? 'text-accent' : 'text-muted'}`}>Paid</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showFreeOnly}
                    onClick={() => setShowFreeOnly(!showFreeOnly)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showFreeOnly ? 'bg-green' : 'bg-border'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${showFreeOnly ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                  </button>
                  <span className={`text-xs font-medium ${showFreeOnly ? 'text-green' : 'text-muted'}`}>Free</span>
                </div>
                {orLoading ? (
                  <p className="text-sm text-muted py-2">Loading models…</p>
                ) : orError ? (
                  <p className="text-sm text-red py-2">{orError}</p>
                ) : (
                  <>
                    <select value={llmModel} onChange={e => setLlmModel(e.target.value)} className="w-full">
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
              </div>
            )}

            {llmProvider === 'ollama' && (
              <div>
                <label className="text-xs font-medium text-muted uppercase tracking-wider">Local Model</label>
                {olLoading ? (
                  <p className="text-sm text-muted py-2">Loading models…</p>
                ) : olError ? (
                  <p className="text-sm text-red py-2">{olError}</p>
                ) : (
                  <>
                    <select value={llmModel} onChange={e => setLlmModel(e.target.value)} className="w-full mt-2">
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
              </div>
            )}
          </div>
        </Section>

        {/* ── 4. System Prompt ─────────────────────────────────────────────── */}
        <Section title="4 · System Prompt" hint="Optionally write a custom prompt template using {{pill}} tokens. Leave empty to use the default Wolf-Fin prompt.">
          <PromptEditor
            value={promptTemplate}
            onChange={setPromptTemplate}
            market={market}
          />

          {/* Legacy: additional instructions */}
          <div className="mt-4">
            <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-2">Additional Instructions (appended to prompt)</label>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder="Extra instructions appended after the base or custom prompt…"
              rows={4}
              className="w-full font-mono text-xs"
            />
          </div>
        </Section>

        {/* ── 5. Guardrails ────────────────────────────────────────────────── */}
        <Section title="5 · Guardrails" hint="Toggle order validation rules. All guardrails are enabled by default.">
          <GuardrailsEditor
            value={guardrails}
            onChange={setGuardrails}
            market={market}
          />
        </Section>

        {/* ── Submit ───────────────────────────────────────────────────────── */}
        {err && <p className="text-red text-sm">{err}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting || !symbol}
            className="px-6 py-2.5 text-sm border border-green text-green rounded-lg hover:bg-green-dim disabled:opacity-40 transition-colors font-medium"
          >
            {submitting ? 'Creating…' : '+ Create Agent'}
          </button>
          <Link
            to="/agents"
            className="px-6 py-2.5 text-sm border border-border text-muted rounded-lg hover:border-muted2 hover:text-text transition-colors font-medium"
          >
            Cancel
          </Link>
        </div>

      </form>
    </div>
  )
}
