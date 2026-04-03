import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getSymbol, updateSymbol, triggerAnalysis } from '../api/client.ts'
import type { WatchSymbol, IndicatorConfig, CandleConfig, ContextConfig } from '../types/index.ts'
import { useToast } from '../components/Toast.tsx'

// ── Constants ─────────────────────────────────────────────────────────────────

type Tab = 'general' | 'indicators' | 'llm' | 'backtest'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general',    label: 'General'        },
  { id: 'indicators', label: 'Indicators'     },
  { id: 'llm',        label: 'LLM & Strategy' },
  { id: 'backtest',   label: 'Backtest'       },
]

const TF_OPTIONS = [
  { value: 'm1',  label: '1m'  },
  { value: 'm5',  label: '5m'  },
  { value: 'm15', label: '15m' },
  { value: 'm30', label: '30m' },
  { value: 'h1',  label: '1H'  },
  { value: 'h4',  label: '4H'  },
]

const CANDLE_LIMIT_OPTIONS = [50, 100, 200, 500]

const INTERVAL_OPTIONS = [
  { label: '5 min',   value: 5  * 60 * 1000 },
  { label: '15 min',  value: 15 * 60 * 1000 },
  { label: '30 min',  value: 30 * 60 * 1000 },
  { label: '1 hour',  value: 60 * 60 * 1000 },
  { label: '4 hours', value: 4  * 60 * 60 * 1000 },
  { label: '8 hours', value: 8  * 60 * 60 * 1000 },
  { label: '1 day',   value: 24 * 60 * 60 * 1000 },
]

const LLM_PROVIDERS = [
  { value: '',                       label: 'Platform default' },
  { value: 'anthropic',              label: 'Anthropic (API Key)' },
  { value: 'anthropic-subscription', label: 'Anthropic (Subscription)' },
  { value: 'openrouter',             label: 'OpenRouter' },
  { value: 'ollama',                 label: 'Ollama' },
  { value: 'openai-subscription',    label: 'OpenAI (ChatGPT)' },
]


type IndicatorKey = keyof IndicatorConfig

const INDICATOR_GROUPS: { label: string; items: Array<{ key: IndicatorKey; label: string; periodKey?: IndicatorKey; periodLabel?: string; extra?: { key: IndicatorKey; label: string } }> }[] = [
  {
    label: 'Oscillators',
    items: [
      { key: 'rsiEnabled',       label: 'RSI',          periodKey: 'rsiPeriod',  periodLabel: 'Period' },
      { key: 'stochEnabled',     label: 'Stochastic'    },
      { key: 'cciEnabled',       label: 'CCI'           },
      { key: 'williamsREnabled', label: 'Williams %R'   },
      { key: 'mfiEnabled',       label: 'MFI'           },
    ],
  },
  {
    label: 'Trend',
    items: [
      { key: 'emaFastEnabled',   label: 'EMA Fast',     periodKey: 'emaFast',    periodLabel: 'Period' },
      { key: 'emaSlowEnabled',   label: 'EMA Slow',     periodKey: 'emaSlow',    periodLabel: 'Period' },
      { key: 'macdEnabled',      label: 'MACD'          },
      { key: 'adxEnabled',       label: 'ADX'           },
      { key: 'psarEnabled',      label: 'Parabolic SAR' },
      { key: 'ichimokuEnabled',  label: 'Ichimoku'      },
    ],
  },
  {
    label: 'Volatility',
    items: [
      { key: 'atrEnabled',       label: 'ATR',          periodKey: 'atrPeriod',  periodLabel: 'Period' },
      { key: 'bbEnabled',        label: 'Bollinger Bands', periodKey: 'bbPeriod', periodLabel: 'Period', extra: { key: 'bbStdDev', label: 'StdDev' } },
      { key: 'keltnerEnabled',   label: 'Keltner Channel' },
    ],
  },
  {
    label: 'Volume',
    items: [
      { key: 'vwapEnabled',      label: 'VWAP' },
      { key: 'obvEnabled',       label: 'OBV'  },
    ],
  },
  {
    label: 'Multi-Timeframe',
    items: [
      { key: 'mtfEnabled',       label: 'MTF Confluence (M15 / H1 / H4)' },
    ],
  },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">{children}</h3>
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-text mb-1">{label}</label>
      {hint && <p className="text-xs text-muted mb-2 leading-relaxed">{hint}</p>}
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <div
        onClick={() => onChange(!checked)}
        className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${checked ? 'bg-green' : 'bg-surface2 border border-border'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-sm text-text">{label}</span>
    </label>
  )
}

// ── General Tab ───────────────────────────────────────────────────────────────

function GeneralTab({ sym, onSave }: { sym: WatchSymbol; onSave: (patch: Partial<WatchSymbol>) => Promise<void> }) {
  const [displayName, setDisplayName] = useState(sym.displayName ?? '')
  const [tf, setTf]                   = useState<CandleConfig['primaryTimeframe']>(sym.candleConfig?.primaryTimeframe ?? 'h1')
  const [limit, setLimit]             = useState(sym.candleConfig?.limit ?? 100)
  const [schedule, setSchedule]       = useState(sym.scheduleEnabled)
  const [interval, setInterval]       = useState(sym.scheduleIntervalMs ?? INTERVAL_OPTIONS[3].value)
  const [startUtc, setStartUtc]       = useState(sym.scheduleStartUtc ?? '')
  const [endUtc, setEndUtc]           = useState(sym.scheduleEndUtc ?? '')
  const [news, setNews]               = useState(sym.contextConfig?.forexNews !== false)
  const [calendar, setCalendar]       = useState(sym.contextConfig?.economicCalendar !== false)
  const [notifyMode, setNotifyMode]   = useState<'all' | 'trade_only' | 'off'>(sym.notifyMode ?? 'all')
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const patch: Partial<WatchSymbol> = {
        displayName:        displayName.trim() || undefined,
        candleConfig:       { primaryTimeframe: tf as CandleConfig['primaryTimeframe'], limit },
        scheduleEnabled:    schedule,
        scheduleIntervalMs: schedule ? interval : undefined,
        scheduleStartUtc:   schedule && startUtc ? startUtc : undefined,
        scheduleEndUtc:     schedule && endUtc   ? endUtc   : undefined,
        contextConfig:      { forexNews: news, economicCalendar: calendar } satisfies ContextConfig,
        notifyMode,
      }
      await onSave(patch)
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-8">
      {/* Identity */}
      <section className="bg-surface border border-border rounded-xl p-5 space-y-5">
        <SectionTitle>Identity</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Symbol" hint="Read-only — determined by the symbol key">
            <input type="text" value={sym.symbol} readOnly className="opacity-50 cursor-not-allowed" />
          </Field>
          <Field label="Display Name" hint="Friendly label shown in the UI (optional)">
            <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder={sym.symbol} />
          </Field>
        </div>
      </section>

      {/* Market data */}
      <section className="bg-surface border border-border rounded-xl p-5 space-y-5">
        <SectionTitle>Market Data</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Primary Timeframe" hint="Timeframe used for the main analysis and chart">
            <div className="flex gap-2 flex-wrap">
              {TF_OPTIONS.map(o => (
                <button key={o.value} onClick={() => setTf(o.value as CandleConfig['primaryTimeframe'])}
                  className={`px-4 py-2 text-sm rounded-lg border font-mono transition-colors ${
                    tf === o.value ? 'border-green text-green bg-green/10' : 'border-border text-muted hover:border-muted2 hover:text-text'
                  }`}>{o.label}</button>
              ))}
            </div>
          </Field>
          <Field label="Candle Limit" hint="How many bars to send to the LLM per analysis">
            <div className="flex gap-2">
              {CANDLE_LIMIT_OPTIONS.map(n => (
                <button key={n} onClick={() => setLimit(n)}
                  className={`px-4 py-2 text-sm rounded-lg border font-mono transition-colors ${
                    limit === n ? 'border-green text-green bg-green/10' : 'border-border text-muted hover:border-muted2 hover:text-text'
                  }`}>{n}</button>
              ))}
            </div>
          </Field>
        </div>
      </section>

      {/* Schedule */}
      <section className="bg-surface border border-border rounded-xl p-5 space-y-5">
        <SectionTitle>Auto-Analysis Schedule</SectionTitle>
        <Toggle checked={schedule} onChange={setSchedule} label="Enable automatic analysis on a schedule" />
        {schedule && (
          <div className="space-y-5 pl-2 border-l-2 border-green/30">
            <Field label="Interval" hint="How often to run the analysis automatically">
              <div className="flex flex-wrap gap-2">
                {INTERVAL_OPTIONS.map(o => (
                  <button key={o.value} onClick={() => setInterval(o.value)}
                    className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                      interval === o.value ? 'border-green text-green bg-green/10' : 'border-border text-muted hover:border-muted2 hover:text-text'
                    }`}>{o.label}</button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Window Start (UTC)" hint="Only run analyses after this time">
                <input type="time" value={startUtc} onChange={e => setStartUtc(e.target.value)} />
              </Field>
              <Field label="Window End (UTC)" hint="Stop running analyses after this time">
                <input type="time" value={endUtc} onChange={e => setEndUtc(e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-muted2">Leave both blank for 24/7 operation. Spans midnight are supported (e.g. 22:00 → 06:00).</p>
          </div>
        )}
      </section>

      {/* Context */}
      <section className="bg-surface border border-border rounded-xl p-5 space-y-4">
        <SectionTitle>Market Context</SectionTitle>
        <p className="text-xs text-muted">External data sources injected into each analysis prompt.</p>
        <div className="space-y-3">
          <Toggle checked={news} onChange={setNews} label="Forex news sentiment (Finnhub)" />
          <Toggle checked={calendar} onChange={setCalendar} label="Economic calendar events" />
        </div>
      </section>

      {/* Telegram Notifications */}
      <section className="bg-surface border border-border rounded-xl p-5 space-y-4">
        <SectionTitle>Telegram Notifications</SectionTitle>
        <p className="text-xs text-muted">Control when this symbol sends notifications to Telegram. Requires Telegram bot to be configured in Settings.</p>
        <div className="flex flex-wrap gap-2">
          {([
            { value: 'all' as const, label: 'Every Analysis', desc: 'Notify on every completed analysis' },
            { value: 'trade_only' as const, label: 'Trade Proposals Only', desc: 'Only notify when a trade setup is found' },
            { value: 'off' as const, label: 'Off', desc: 'No Telegram notifications for this symbol' },
          ]).map(opt => (
            <button
              key={opt.value}
              onClick={() => setNotifyMode(opt.value)}
              className={`px-4 py-2.5 text-sm rounded-lg border transition-colors text-left ${
                notifyMode === opt.value
                  ? 'border-green text-green bg-green/10'
                  : 'border-border text-muted hover:border-muted2 hover:text-text'
              }`}
              title={opt.desc}
            >
              {opt.value === 'all' && '🔔 '}{opt.value === 'trade_only' && '📊 '}{opt.value === 'off' && '🔕 '}
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted2">
          {notifyMode === 'all' && 'You will receive a Telegram message for every analysis — including bias, indicators, and trade proposals.'}
          {notifyMode === 'trade_only' && 'You will only be notified when the AI finds an actionable trade setup with entry, SL, and TP levels.'}
          {notifyMode === 'off' && 'No Telegram messages will be sent for this symbol. Analyses still run and are saved.'}
        </p>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-green">
          {saving ? 'Saving…' : 'Save General Settings'}
        </button>
        {saved && <span className="text-sm text-green">Saved</span>}
      </div>
    </div>
  )
}

// ── Indicators Tab ────────────────────────────────────────────────────────────

function IndicatorsTab({ sym, onSave }: { sym: WatchSymbol; onSave: (patch: Partial<WatchSymbol>) => Promise<void> }) {
  const [cfg, setCfg] = useState<IndicatorConfig>(sym.indicatorConfig ?? {})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  const setEnabled = (key: IndicatorKey, val: boolean) => setCfg(p => ({ ...p, [key]: val }))
  const setPeriod  = (key: IndicatorKey, val: string)  => {
    const n = parseInt(val, 10)
    if (!isNaN(n) && n > 0) setCfg(p => ({ ...p, [key]: n }))
    else if (val === '') setCfg(p => { const c = { ...p }; delete c[key]; return c })
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave({ indicatorConfig: cfg })
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } finally { setSaving(false) }
  }

  const enableAll = () => {
    const next: IndicatorConfig = { ...cfg }
    INDICATOR_GROUPS.forEach(g => g.items.forEach(item => { next[item.key] = true as never }))
    setCfg(next)
  }

  const disableAll = () => {
    const next: IndicatorConfig = { ...cfg }
    INDICATOR_GROUPS.forEach(g => g.items.forEach(item => { next[item.key] = false as never }))
    setCfg(next)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={enableAll}  className="btn-secondary text-xs">Enable all</button>
        <button onClick={disableAll} className="btn-secondary text-xs">Disable all</button>
        <p className="text-xs text-muted">Disabled indicators are excluded from the analysis prompt to save tokens.</p>
      </div>

      {INDICATOR_GROUPS.map(group => (
        <section key={group.label} className="bg-surface border border-border rounded-xl p-5">
          <SectionTitle>{group.label}</SectionTitle>
          <div className="space-y-4">
            {group.items.map(item => {
              const enabled = cfg[item.key] !== false
              return (
                <div key={item.key} className="flex items-center gap-4">
                  {/* Toggle */}
                  <div className="w-40 flex-shrink-0">
                    <Toggle checked={!!enabled} onChange={v => setEnabled(item.key, v)} label={item.label} />
                  </div>

                  {/* Period input(s) — only shown when enabled */}
                  {enabled && item.periodKey && (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted">{item.periodLabel ?? 'Period'}:</span>
                        <input
                          type="number" min="1" max="500"
                          value={(cfg[item.periodKey] as number | undefined) ?? ''}
                          onChange={e => setPeriod(item.periodKey!, e.target.value)}
                          placeholder="default"
                          className="w-20 text-xs font-mono"
                        />
                      </div>
                      {item.extra && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted">{item.extra.label}:</span>
                          <input
                            type="number" min="0.1" max="10" step="0.1"
                            value={(cfg[item.extra.key] as number | undefined) ?? ''}
                            onChange={e => setPeriod(item.extra!.key, e.target.value)}
                            placeholder="default"
                            className="w-20 text-xs font-mono"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-green">
          {saving ? 'Saving…' : 'Save Indicators'}
        </button>
        {saved && <span className="text-sm text-green">Saved</span>}
      </div>
    </div>
  )
}

// ── LLM & Strategy Tab ────────────────────────────────────────────────────────

interface PromptPreview { systemPrompt: string; strategy: string | null; strategyName?: string | null; hasCustom: boolean }

function LLMTab({ sym, onSave }: { sym: WatchSymbol; onSave: (patch: Partial<WatchSymbol>) => Promise<void> }) {
  const [strategy,     setStrategy]     = useState(sym.strategy     ?? '')
  const [provider,     setProvider]     = useState(sym.llmProvider   ?? '')
  const [model,        setModel]        = useState(sym.llmModel      ?? '')
  const [systemPrompt, setSystemPrompt] = useState(sym.systemPrompt  ?? '')
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [preview, setPreview]           = useState<PromptPreview | null>(null)
  const [previewOpen, setPreviewOpen]   = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [strategies, setStrategies]     = useState<Array<{ key: string; name: string; description: string | null; isBuiltin: boolean }>>([])

  useEffect(() => {
    fetch('/api/strategies').then(r => r.json()).then((data: Array<{ key: string; name: string; description: string | null; isBuiltin: boolean }>) => setStrategies(data)).catch(() => {})
  }, [])

  const loadPreview = async () => {
    setPreviewLoading(true)
    try {
      const res = await fetch(`/api/symbols/${encodeURIComponent(sym.key)}/prompt`)
      const data = await res.json() as PromptPreview
      setPreview(data)
      setPreviewOpen(true)
    } finally { setPreviewLoading(false) }
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave({
        strategy:     strategy  || undefined,
        llmProvider:  provider  ? provider as WatchSymbol['llmProvider'] : undefined,
        llmModel:     model     || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
      })
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } finally { setSaving(false) }
  }

  const hasCustomPrompt = systemPrompt.trim().length > 0

  // Balanced (no strategy) + all loaded strategies
  const strategyOptions = [
    { key: '', name: 'Balanced', description: 'Standard technical analysis — bias, key levels, trade setup', isBuiltin: true },
    ...strategies,
  ]

  return (
    <div className="space-y-6">
      {/* Strategy */}
      <section className="bg-surface border border-border rounded-xl p-5">
        <SectionTitle>Analysis Strategy</SectionTitle>
        <p className="text-xs text-muted mb-4">
          Shapes the LLM's analytical approach. Overridden by a custom system prompt if one is set.{' '}
          <a href="/strategies" className="text-green hover:underline">Manage strategies →</a>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {strategyOptions.map(s => (
            <button
              key={s.key}
              onClick={() => setStrategy(s.key)}
              className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                strategy === s.key
                  ? 'border-green bg-green/10 text-green'
                  : 'border-border text-text hover:border-muted2'
              } ${hasCustomPrompt ? 'opacity-40' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold">{s.name}</span>
                {!s.isBuiltin && <span className="text-[9px] text-purple-400 border border-purple-400/30 rounded px-1">custom</span>}
              </div>
              <div className="text-xs text-muted leading-relaxed">{s.description ?? ''}</div>
            </button>
          ))}
        </div>
        {hasCustomPrompt && (
          <p className="text-xs text-yellow mt-3">Strategy is overridden by your custom system prompt below.</p>
        )}
      </section>

      {/* LLM override */}
      <section className="bg-surface border border-border rounded-xl p-5 space-y-4">
        <SectionTitle>LLM Override</SectionTitle>
        <p className="text-xs text-muted">Use a different model for this symbol only. Leave on "Platform default" to use the global setting.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Provider">
            <select value={provider} onChange={e => setProvider(e.target.value)}>
              {LLM_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Model" hint="Leave blank to use the provider's default">
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="e.g. claude-opus-4-6, gpt-5.4"
              className="font-mono text-sm"
            />
          </Field>
        </div>
      </section>

      {/* Custom system prompt */}
      <section className="bg-surface border border-border rounded-xl p-5 space-y-3">
        <SectionTitle>Custom System Prompt</SectionTitle>
        <p className="text-xs text-muted leading-relaxed">
          Fully replaces the default system prompt and strategy. Use this for complete control over how the LLM reasons.
          Leave blank to use the strategy preset above.
        </p>
        {hasCustomPrompt && (
          <div className="flex items-center gap-2 px-3 py-2 bg-green/10 border border-green/30 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-green flex-shrink-0" />
            <span className="text-xs text-green">Custom prompt active — strategy preset is overridden</span>
          </div>
        )}
        <textarea
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          placeholder={`You are a professional forex analyst specializing in ${sym.symbol}…`}
          rows={10}
          className="font-mono text-sm leading-relaxed"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted2">{systemPrompt.length} characters</span>
          {hasCustomPrompt && (
            <button onClick={() => setSystemPrompt('')} className="text-xs text-muted hover:text-red transition-colors">
              Clear prompt
            </button>
          )}
        </div>
      </section>

      {/* Prompt preview */}
      <section className="bg-surface border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <SectionTitle>Effective System Prompt</SectionTitle>
            <p className="text-xs text-muted">Preview the exact system prompt that will be sent to the LLM. Reflects saved settings.</p>
          </div>
          <button onClick={loadPreview} disabled={previewLoading} className="btn-secondary text-sm">
            {previewLoading ? 'Loading…' : previewOpen ? 'Refresh' : 'Preview Prompt'}
          </button>
        </div>

        {previewOpen && preview && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {preview.hasCustom ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green/10 text-green border border-green/30">Custom prompt active</span>
              ) : preview.strategy ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-accent-dim text-accent border border-accent/30">
                  Strategy: {preview.strategyName ?? preview.strategy}
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-surface2 text-muted border border-border">Default</span>
              )}
            </div>
            <pre className="bg-bg border border-border rounded-lg p-4 text-xs font-mono text-muted leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-80 overflow-y-auto">
              {preview.systemPrompt}
            </pre>
            <p className="text-xs text-muted2">
              The user message (market data, candles, indicators) is generated live at analysis time and is not shown here.
            </p>
          </div>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-green">
          {saving ? 'Saving…' : 'Save LLM Settings'}
        </button>
        {saved && <span className="text-sm text-green">Saved</span>}
      </div>
    </div>
  )
}

// ── Backtest Tab ──────────────────────────────────────────────────────────────

interface BacktestResult {
  analysisId:   number
  time:         string
  bias:         string
  direction:    string | null
  entryLow:     number
  entryHigh:    number
  sl:           number
  tp1:          number
  rr:           number
  confidence:   string
}

function BacktestTab({ sym }: { sym: WatchSymbol }) {
  const [lookForward, setLookForward] = useState(20)
  const [minRR,       setMinRR]       = useState(1.5)
  const [running,     setRunning]     = useState(false)
  const [results,     setResults]     = useState<BacktestResult[] | null>(null)
  const [error,       setError]       = useState<string | null>(null)

  const run = async () => {
    setRunning(true); setError(null); setResults(null)
    try {
      const res = await fetch(`/api/symbols/${encodeURIComponent(sym.key)}/backtest?lookForward=${lookForward}&minRR=${minRR}`)
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as BacktestResult[]
      setResults(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const wins   = results?.filter(r => r.direction !== null).length ?? 0
  const total  = results?.filter(r => r.direction !== null).length ?? 0

  return (
    <div className="space-y-6">
      <section className="bg-surface border border-border rounded-xl p-5 space-y-5">
        <SectionTitle>Backtest Configuration</SectionTitle>
        <p className="text-xs text-muted leading-relaxed">
          Evaluates historical trade proposals stored in the analyses database.
          For each proposal, checks if the first take-profit was reached before the stop-loss
          using the candle data from the bridge.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field
            label="Look-Forward Bars"
            hint="How many bars after each analysis to check for TP/SL hit"
          >
            <div className="flex items-center gap-3">
              <input
                type="range" min="5" max="100" step="5"
                value={lookForward}
                onChange={e => setLookForward(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-sm font-mono text-text w-8 text-right">{lookForward}</span>
            </div>
          </Field>

          <Field
            label="Min R:R Filter"
            hint="Only evaluate proposals with at least this risk-reward ratio"
          >
            <div className="flex items-center gap-3">
              <input
                type="range" min="0.5" max="5" step="0.5"
                value={minRR}
                onChange={e => setMinRR(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-sm font-mono text-text w-8 text-right">{minRR.toFixed(1)}</span>
            </div>
          </Field>
        </div>

        <button onClick={run} disabled={running} className="btn-green">
          {running ? 'Running backtest…' : 'Run Backtest'}
        </button>

        {error && (
          <div className="px-4 py-3 bg-red/10 border border-red/30 rounded-lg text-xs text-red">
            {error}
          </div>
        )}
      </section>

      {results !== null && (
        <section className="bg-surface border border-border rounded-xl p-5 space-y-4">
          <SectionTitle>Results</SectionTitle>

          {results.length === 0 ? (
            <p className="text-sm text-muted">No trade proposals found in analysis history matching the criteria.</p>
          ) : (
            <>
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-bg border border-border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-text">{results.filter(r => r.direction !== null).length}</div>
                  <div className="text-xs text-muted mt-1">Total proposals</div>
                </div>
                <div className="bg-bg border border-border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-text">{wins}</div>
                  <div className="text-xs text-muted mt-1">With direction</div>
                </div>
                <div className="bg-bg border border-border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-text">{total > 0 ? (results.reduce((s, r) => s + r.rr, 0) / total).toFixed(2) : '—'}</div>
                  <div className="text-xs text-muted mt-1">Avg R:R</div>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted text-left">
                      <th className="pb-2 pr-4">Date</th>
                      <th className="pb-2 pr-4">Bias</th>
                      <th className="pb-2 pr-4">Direction</th>
                      <th className="pb-2 pr-4">Entry</th>
                      <th className="pb-2 pr-4">SL</th>
                      <th className="pb-2 pr-4">TP1</th>
                      <th className="pb-2 pr-4">R:R</th>
                      <th className="pb-2">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(r => (
                      <tr key={r.analysisId} className="border-b border-border/50 hover:bg-surface2 transition-colors">
                        <td className="py-2 pr-4 font-mono text-muted2">{new Date(r.time).toLocaleDateString()}</td>
                        <td className={`py-2 pr-4 font-semibold ${r.bias === 'bullish' ? 'text-green' : r.bias === 'bearish' ? 'text-red' : 'text-muted'}`}>
                          {r.bias}
                        </td>
                        <td className={`py-2 pr-4 font-mono font-semibold ${r.direction === 'BUY' ? 'text-green' : r.direction === 'SELL' ? 'text-red' : 'text-muted'}`}>
                          {r.direction ?? '—'}
                        </td>
                        <td className="py-2 pr-4 font-mono text-muted2">{r.entryLow > 0 ? `${r.entryLow} – ${r.entryHigh}` : '—'}</td>
                        <td className="py-2 pr-4 font-mono text-red">{r.sl > 0 ? r.sl : '—'}</td>
                        <td className="py-2 pr-4 font-mono text-green">{r.tp1 > 0 ? r.tp1 : '—'}</td>
                        <td className="py-2 pr-4 font-mono">{r.rr > 0 ? r.rr.toFixed(2) : '—'}</td>
                        <td className={`py-2 text-xs ${r.confidence === 'high' ? 'text-green' : r.confidence === 'low' ? 'text-red' : 'text-muted'}`}>
                          {r.confidence}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SymbolConfig() {
  const { key }      = useParams<{ key: string }>()
  const navigate     = useNavigate()
  const toast        = useToast()
  const [tab, setTab]     = useState<Tab>('general')
  const [sym, setSym]     = useState<WatchSymbol | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)

  const load = useCallback(async () => {
    if (!key) return
    try {
      const data = await getSymbol(decodeURIComponent(key))
      setSym(data)
    } catch {
      toast.error('Symbol not found')
      navigate('/symbols')
    } finally {
      setLoading(false)
    }
  }, [key, navigate, toast])

  useEffect(() => { load() }, [load])

  const handleSave = useCallback(async (patch: Partial<WatchSymbol>) => {
    if (!key) return
    await updateSymbol(decodeURIComponent(key), patch)
    await load()
    toast.success('Saved')
  }, [key, load, toast])

  const handleAnalyze = async () => {
    if (!key) return
    setAnalyzing(true)
    try {
      await triggerAnalysis(decodeURIComponent(key))
      toast.info('Analysis started')
    } catch (e) { toast.error(String(e)) }
    finally { setAnalyzing(false) }
  }

  if (loading) return <div className="p-6 text-muted text-sm">Loading…</div>
  if (!sym)    return null

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/symbols" className="text-muted hover:text-text transition-colors text-sm">
            ← Watchlist
          </Link>
          <span className="text-border">·</span>
          <div>
            <h1 className="text-xl font-bold font-mono text-text">{sym.symbol}</h1>
            {sym.displayName && <p className="text-xs text-muted">{sym.displayName}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/symbols/${encodeURIComponent(sym.key)}`}
            className="btn-secondary text-sm"
          >
            View Analysis
          </Link>
          <button onClick={handleAnalyze} disabled={analyzing} className="btn-green text-sm">
            {analyzing ? 'Running…' : 'Analyze Now'}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2 ${
              tab === t.id
                ? 'text-green border-green'
                : 'text-muted border-transparent hover:text-text'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'general'    && <GeneralTab    sym={sym} onSave={handleSave} />}
      {tab === 'indicators' && <IndicatorsTab sym={sym} onSave={handleSave} />}
      {tab === 'llm'        && <LLMTab        sym={sym} onSave={handleSave} />}
      {tab === 'backtest'   && <BacktestTab   sym={sym} />}
    </div>
  )
}
