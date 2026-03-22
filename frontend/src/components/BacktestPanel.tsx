// Wolf-Fin — Backtesting Panel (MT5 agents only)

import { useState, useEffect } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid,
} from 'recharts'
import type { BacktestParams, BacktestResponse, BacktestTradeResult, BacktestStats, BacktestReport } from '../api/client.ts'
import type { AgentConfig } from '../types/index.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt     = (v: number) => (v >= 0 ? `+$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`)
const fmtUsd  = (v: number | null) => v == null ? '—' : (v >= 0 ? `+$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`)
const pct     = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`
const dp2     = (v: number | null) => v == null ? '—' : v.toFixed(2)

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, color = 'text-text', sub }: {
  label: string; value: string; color?: string; sub?: string
}) {
  return (
    <div className="bg-surface2 border border-border/60 rounded-lg px-4 py-3">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted/60 mt-0.5">{sub}</div>}
    </div>
  )
}

function TradeRow({ t, idx }: { t: BacktestTradeResult; idx: number }) {
  const win = t.pnlUsd > 0
  return (
    <tr className={`text-xs border-b border-border/30 ${idx % 2 === 0 ? '' : 'bg-surface2/40'}`}>
      <td className="py-1.5 px-3 font-mono text-muted">{t.openTime.slice(0, 16).replace('T', ' ')}</td>
      <td className="py-1.5 px-3">
        <span className={`font-bold text-[10px] px-1.5 py-0.5 rounded border ${t.direction === 'LONG' ? 'text-green border-green/40 bg-green/8' : 'text-red border-red/40 bg-red/8'}`}>
          {t.direction}
        </span>
      </td>
      <td className="py-1.5 px-3 font-mono">{t.entry.toFixed(5)}</td>
      <td className="py-1.5 px-3 font-mono">{t.exit.toFixed(5)}</td>
      <td className="py-1.5 px-3">
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${t.exitReason === 'TP' ? 'text-green bg-green/10' : t.exitReason === 'SL' ? 'text-red bg-red/10' : 'text-muted bg-surface3'}`}>
          {t.exitReason}
        </span>
      </td>
      <td className={`py-1.5 px-3 font-mono font-semibold ${win ? 'text-green' : 'text-red'}`}>{fmt(t.pnlUsd)}</td>
      <td className="py-1.5 px-3 font-mono text-muted">{t.barsHeld}</td>
      <td className="py-1.5 px-3 font-mono text-muted/70">{t.rsiAtEntry}</td>
    </tr>
  )
}

// ── Strategy Blueprint ────────────────────────────────────────────────────────

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-accent bg-accent/10 px-1 py-0.5 rounded text-[11px]">{children}</code>
}

function BlueprintRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-xs leading-relaxed py-1.5 border-b border-border/30 last:border-0">
      <span className="text-muted/60 w-28 shrink-0 pt-0.5">{label}</span>
      <span className="text-text/80">{children}</span>
    </div>
  )
}

function StrategyBlueprint({ rsiPeriod, emaFast, emaSlow, atrPeriod, rsiOversold, rsiOverbought, requireEma, slMult, tpMult, maxHoldBars, maxRiskPct, timeframe }: {
  rsiPeriod: number; emaFast: number; emaSlow: number; atrPeriod: number
  rsiOversold: number; rsiOverbought: number; requireEma: boolean
  slMult: number; tpMult: number; maxHoldBars: number; maxRiskPct: number
  timeframe: string
}) {
  const warmup = Math.max(rsiPeriod, emaSlow, atrPeriod) + 5
  const emaLabel = requireEma
    ? <> and <Code>EMA{emaFast} &gt; EMA{emaSlow}</Code></>
    : <span className="text-muted/50"> (no EMA filter)</span>
  const emaLabelShort = requireEma
    ? <> and <Code>EMA{emaFast} &lt; EMA{emaSlow}</Code></>
    : null

  return (
    <div className="bg-surface3/50 border border-border/50 rounded-lg p-4 mt-1 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">📋</span>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">Strategy Blueprint</span>
        <span className="text-[10px] text-muted/40 ml-auto">exactly what the engine simulates</span>
      </div>

      <div className="space-y-0">
        <BlueprintRow label="🟢 Long entry">
          <Code>RSI({rsiPeriod})</Code> crosses below <Code>{rsiOversold}</Code>{emaLabel}
        </BlueprintRow>
        <BlueprintRow label="🔴 Short entry">
          <Code>RSI({rsiPeriod})</Code> crosses above <Code>{rsiOverbought}</Code>{emaLabelShort}
        </BlueprintRow>
        <BlueprintRow label="🛑 Stop Loss">
          Entry price ± <Code>ATR({atrPeriod}) × {slMult}</Code> — checked against bar low/high each {timeframe} bar
        </BlueprintRow>
        <BlueprintRow label="🎯 Take Profit">
          Entry price ± <Code>ATR({atrPeriod}) × {tpMult}</Code> — R:R of <Code>{(tpMult / slMult).toFixed(2)}:1</Code>
        </BlueprintRow>
        <BlueprintRow label="⏱ Force-close">
          If neither SL nor TP hit after <Code>{maxHoldBars}</Code> bars, close at bar close
        </BlueprintRow>
        <BlueprintRow label="💰 Position size">
          Risk <Code>{maxRiskPct}%</Code> of current equity per trade — lot size = riskUSD ÷ (SL pips × pip value). Compounds each trade.
        </BlueprintRow>
        <BlueprintRow label="⏳ Warmup">
          First <Code>{warmup}</Code> bars skipped — needed for RSI({rsiPeriod}), EMA{emaSlow} and ATR({atrPeriod}) to stabilise
        </BlueprintRow>
        <BlueprintRow label="⚠️ Not modelled">
          <span className="text-muted/60">Spread · Slippage · Gaps · News filters · LLM reasoning · Session times · Trailing stops · Pyramiding</span>
        </BlueprintRow>
      </div>
    </div>
  )
}

// ── AI Report ─────────────────────────────────────────────────────────────────

const RATING_META: Record<BacktestReport['verdict']['rating'], { label: string; color: string; bg: string; border: string }> = {
  STRONG:   { label: 'Strong Edge',    color: 'text-green',   bg: 'bg-green/8',   border: 'border-green/30' },
  VIABLE:   { label: 'Viable',         color: 'text-accent',  bg: 'bg-accent/8',  border: 'border-accent/30' },
  MARGINAL: { label: 'Marginal',       color: 'text-yellow',  bg: 'bg-yellow/8',  border: 'border-yellow/30' },
  AVOID:    { label: 'Avoid Live',     color: 'text-red',     bg: 'bg-red/8',     border: 'border-red/30' },
}

const SECTION_ICONS: Record<string, string> = {
  performance:   '📈',
  risk:          '🛡️',
  signals:       '🎯',
  tradePatterns: '🔍',
}

function ReportSection({ icon, title, headline, detail }: { icon: string; title: string; headline: string; detail: string }) {
  return (
    <div className="bg-surface2 border border-border/60 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</span>
      </div>
      <p className="text-sm font-medium text-text mb-1.5">{headline}</p>
      <p className="text-xs text-muted/80 leading-relaxed">{detail}</p>
    </div>
  )
}

function SkeletonBlock({ h = 'h-20' }: { h?: string }) {
  return <div className={`${h} rounded-lg bg-surface3 animate-pulse`} />
}

function AIReport({ loading, error, report, model, onRetry }: {
  loading: boolean
  error: string | null
  report: BacktestReport | null
  model: string
  onRetry: () => void
}) {
  if (!loading && !error && !report) return null

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <span className="text-base">🤖</span>
          <div>
            <span className="text-sm font-semibold text-text">AI Strategy Report</span>
            {model && !loading && (
              <span className="ml-2 text-[10px] text-muted/60 font-mono">{model}</span>
            )}
          </div>
        </div>
        {error && (
          <button onClick={onRetry} className="text-xs text-accent hover:underline">Retry</button>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Loading skeleton */}
        {loading && (
          <>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-4 h-4 rounded-full bg-accent/30 animate-pulse" />
              <p className="text-xs text-muted animate-pulse">Analysing backtest results with AI…</p>
            </div>
            <SkeletonBlock h="h-16" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <SkeletonBlock h="h-28" />
              <SkeletonBlock h="h-28" />
              <SkeletonBlock h="h-28" />
              <SkeletonBlock h="h-28" />
            </div>
            <SkeletonBlock h="h-24" />
          </>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="text-xs text-red/80 bg-red/8 border border-red/20 rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {/* Report */}
        {report && !loading && (() => {
          const meta = RATING_META[report.verdict.rating] ?? RATING_META.MARGINAL
          return (
            <>
              {/* Verdict banner */}
              <div className={`${meta.bg} border ${meta.border} rounded-lg px-4 py-3.5 flex items-start gap-3`}>
                <div className={`text-xs font-bold px-2.5 py-1 rounded-md border ${meta.bg} ${meta.border} ${meta.color} shrink-0 mt-0.5`}>
                  {meta.label}
                </div>
                <p className={`text-sm leading-relaxed ${meta.color}`}>{report.verdict.summary}</p>
              </div>

              {/* Section grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ReportSection icon={SECTION_ICONS.performance}   title="Performance"    headline={report.performance.headline}   detail={report.performance.detail} />
                <ReportSection icon={SECTION_ICONS.risk}          title="Risk Profile"   headline={report.risk.headline}          detail={report.risk.detail} />
                <ReportSection icon={SECTION_ICONS.signals}       title="Signal Quality" headline={report.signals.headline}       detail={report.signals.detail} />
                <ReportSection icon={SECTION_ICONS.tradePatterns} title="Trade Patterns" headline={report.tradePatterns.headline} detail={report.tradePatterns.detail} />
              </div>

              {/* Optimizations */}
              {report.optimizations.length > 0 && (
                <div className="bg-surface2 border border-border/60 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-base">⚙️</span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted">Optimization Suggestions</span>
                  </div>
                  <ol className="space-y-2">
                    {report.optimizations.map((opt, i) => (
                      <li key={i} className="flex gap-2.5 text-xs text-muted/80 leading-relaxed">
                        <span className="text-accent font-mono font-bold shrink-0 mt-0.5">{i + 1}.</span>
                        <span>{opt}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )
        })()}
      </div>
    </div>
  )
}

// ── Config form ───────────────────────────────────────────────────────────────

const TIMEFRAMES = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const
const BAR_PRESETS: Record<string, number> = {
  '500 bars':  500,
  '1,000 bars': 1000,
  '2,000 bars': 2000,
  '5,000 bars': 5000,
  '10,000 bars': 10000,
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  agentKey: string
  config:   AgentConfig
}

export function BacktestPanel({ agentKey, config }: Props) {
  // Gate: Binance agents cannot use this panel
  if (config.market !== 'mt5') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center max-w-lg mx-auto">
        <div className="text-4xl">🚫</div>
        <h3 className="text-lg font-semibold text-text">Backtesting Unavailable for Binance</h3>
        <p className="text-sm text-muted leading-relaxed">
          Backtesting requires reliable historical OHLCV data with precise execution semantics
          (pip size, pip value, spread). Binance's REST API provides kline data but lacks the
          broker-level execution model needed for accurate P&amp;L simulation.
        </p>
        <p className="text-sm text-muted leading-relaxed">
          Backtesting is only supported for <span className="text-accent font-medium">MT5 agents</span>,
          where data is fetched directly from your connected broker's history with exact instrument specs.
        </p>
      </div>
    )
  }

  // ── State ──────────────────────────────────────────────────────────────────
  const [timeframe,        setTimeframe]        = useState<typeof TIMEFRAMES[number]>('H1')
  const [bars,             setBars]             = useState(2000)
  const [slMult,           setSlMult]           = useState(1.0)
  const [tpMult,           setTpMult]           = useState(1.5)
  const [maxHoldBars,      setMaxHoldBars]      = useState(60)
  const [rsiOversold,      setRsiOversold]      = useState(35)
  const [rsiOverbought,    setRsiOverbought]    = useState(65)
  const [requireEma,       setRequireEma]       = useState(true)
  const [rsiPeriod,        setRsiPeriod]        = useState(14)
  const [emaFast,          setEmaFast]          = useState(20)
  const [emaSlow,          setEmaSlow]          = useState(50)
  const [atrPeriod,        setAtrPeriod]        = useState(14)
  const [startEquity,      setStartEquity]      = useState(10_000)
  const [maxRiskPct,       setMaxRiskPct]       = useState(config.maxRiskPercent ?? 2)

  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [result,        setResult]        = useState<BacktestResponse | null>(null)
  const [showTrades,    setShowTrades]    = useState(false)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError,   setReportError]   = useState<string | null>(null)
  const [report,        setReport]        = useState<BacktestReport | null>(null)
  const [reportModel,   setReportModel]   = useState<string>('')
  const [savedAt,       setSavedAt]       = useState<string | null>(null)
  const [restoring,     setRestoring]     = useState(true)

  // Restore the last saved backtest on mount
  useEffect(() => {
    const load = async () => {
      try {
        const raw = await fetch(`/api/agent-backtest-result?key=${encodeURIComponent(agentKey)}`)
        if (raw.ok) {
          const data = await raw.json() as {
            ok: boolean
            saved: {
              result: { result: BacktestResponse['result']; timeframe: string; barsRequested: number }
              report: BacktestReport | null
              model:  string | null
              ranAt:  string
            } | null
          }
          if (data.ok && data.saved) {
            const { result: stored, report: storedReport, model: storedModel, ranAt } = data.saved
            setResult({ ok: true, timeframe: stored.timeframe, barsRequested: stored.barsRequested, result: stored.result })
            if (storedReport) {
              setReport(storedReport)
              setReportModel(storedModel ?? '')
            }
            setSavedAt(ranAt)
          }
        }
      } catch { /* silently skip — first run has no saved data */ }
      finally  { setRestoring(false) }
    }
    load()
  }, [agentKey])

  const fetchReport = async (res: BacktestResponse) => {
    setReportLoading(true)
    setReportError(null)
    setReport(null)
    try {
      const raw = await fetch('/api/agent-backtest-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: agentKey,
          timeframe: res.timeframe,
          barsRequested: res.barsRequested,
          result: res.result,
        }),
      })
      if (!raw.ok) {
        const body = await raw.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `Server error ${raw.status}`)
      }
      const data = await raw.json() as { report: BacktestReport; model: string }
      setReport(data.report)
      setReportModel(data.model)
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'Report generation failed')
    } finally {
      setReportLoading(false)
    }
  }

  const handleRun = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    setReport(null)
    setReportError(null)
    setSavedAt(null)
    try {
      const params: BacktestParams = {
        key: agentKey,
        timeframe,
        bars,
        slMult,
        tpMult,
        maxHoldBars,
        rsiOversold,
        rsiOverbought,
        requireEmaConfirm: requireEma,
        rsiPeriod,
        emaFast,
        emaSlow,
        atrPeriod,
        startingEquityUsd: startEquity,
        maxRiskPercent:    maxRiskPct,
      }
      const raw = await fetch('/api/agent-backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!raw.ok) {
        const body = await raw.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `Server error ${raw.status}`)
      }
      const res = await raw.json() as BacktestResponse
      setResult(res)
      setSavedAt(new Date().toISOString())
      // Automatically generate the AI report
      fetchReport(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backtest failed')
    } finally {
      setLoading(false)
    }
  }

  const stats: BacktestStats | undefined = result?.result.stats
  const trades = result?.result.trades ?? []
  const curve  = result?.result.equityCurve ?? []

  // ── Render ─────────────────────────────────────────────────────────────────
  if (restoring) {
    return (
      <div className="flex items-center gap-3 py-12 justify-center text-muted text-sm">
        <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        Loading saved backtest…
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Config card */}
      <div className="bg-surface border border-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-text">Backtest Configuration</h3>
            <p className="text-xs text-muted mt-0.5">
              Signal-based simulation over historical {config.symbol} data from your MT5 broker.
              Entry signals: RSI thresholds + EMA cross. Exits: SL/TP (ATR multiples).
            </p>
          </div>
        </div>

        {/* Row 1 — Timeframe + History + SL/TP */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted font-medium">Timeframe</label>
            <div className="flex flex-wrap gap-1">
              {TIMEFRAMES.map(tf => (
                <button key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${timeframe === tf ? 'border-accent text-accent bg-accent/10' : 'border-border text-muted hover:border-border/80'}`}>
                  {tf}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted font-medium">History</label>
            <div className="flex flex-wrap gap-1">
              {Object.entries(BAR_PRESETS).map(([label, val]) => (
                <button key={val}
                  onClick={() => setBars(val)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${bars === val ? 'border-accent text-accent bg-accent/10' : 'border-border text-muted hover:border-border/80'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted font-medium">SL × ATR</label>
            <input type="number" min={0.3} max={5} step={0.1} value={slMult}
              onChange={e => setSlMult(parseFloat(e.target.value))}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-accent outline-none" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted font-medium">TP × ATR</label>
            <input type="number" min={0.3} max={10} step={0.1} value={tpMult}
              onChange={e => setTpMult(parseFloat(e.target.value))}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-accent outline-none" />
          </div>
        </div>

        {/* Row 2 — RSI thresholds + equity + risk */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted font-medium">RSI Oversold <span className="text-muted/50">(long entry)</span></label>
            <input type="number" min={10} max={49} step={1} value={rsiOversold}
              onChange={e => setRsiOversold(parseInt(e.target.value))}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-accent outline-none" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted font-medium">RSI Overbought <span className="text-muted/50">(short entry)</span></label>
            <input type="number" min={51} max={90} step={1} value={rsiOverbought}
              onChange={e => setRsiOverbought(parseInt(e.target.value))}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-accent outline-none" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted font-medium">Starting Equity ($)</label>
            <input type="number" min={1000} step={1000} value={startEquity}
              onChange={e => setStartEquity(parseFloat(e.target.value))}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-accent outline-none" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted font-medium">Max Risk % / Trade</label>
            <input type="number" min={0.1} max={20} step={0.1} value={maxRiskPct}
              onChange={e => setMaxRiskPct(parseFloat(e.target.value))}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-accent outline-none" />
          </div>
        </div>

        {/* Row 3 — Max hold + EMA toggle (full width, no cramping) */}
        <div className="flex flex-wrap items-end gap-4 mb-5">
          <div className="space-y-1.5 w-40">
            <label className="text-xs text-muted font-medium">Max Hold (bars)</label>
            <input type="number" min={5} max={500} step={5} value={maxHoldBars}
              onChange={e => setMaxHoldBars(parseInt(e.target.value))}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-accent outline-none" />
          </div>
          <button
            onClick={() => setRequireEma(v => !v)}
            className="flex items-center gap-2.5 py-2 group">
            <div className={`w-10 h-5 rounded-full border-2 relative transition-colors flex-shrink-0 ${requireEma ? 'bg-accent border-accent' : 'bg-surface3 border-border'}`}>
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${requireEma ? 'left-5' : 'left-0.5'}`} />
            </div>
            <span className="text-xs text-muted group-hover:text-text/80 transition-colors">
              Require <span className="font-mono text-text/70">EMA{emaFast}</span> &gt; <span className="font-mono text-text/70">EMA{emaSlow}</span> trend confirmation
            </span>
          </button>
        </div>

        {/* Indicator Periods */}
        <div className="border-t border-border/40 pt-4 mb-5">
          <p className="text-[11px] text-muted/50 uppercase tracking-widest font-semibold mb-3">Indicator Periods</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted font-medium">RSI Period</label>
              <input type="number" min={2} max={50} step={1} value={rsiPeriod}
                onChange={e => setRsiPeriod(parseInt(e.target.value))}
                className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-accent outline-none font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted font-medium">EMA Fast</label>
              <input type="number" min={2} max={200} step={1} value={emaFast}
                onChange={e => setEmaFast(parseInt(e.target.value))}
                className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-accent outline-none font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted font-medium">EMA Slow</label>
              <input type="number" min={2} max={500} step={1} value={emaSlow}
                onChange={e => setEmaSlow(parseInt(e.target.value))}
                className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-accent outline-none font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted font-medium">ATR Period</label>
              <input type="number" min={2} max={50} step={1} value={atrPeriod}
                onChange={e => setAtrPeriod(parseInt(e.target.value))}
                className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-accent outline-none font-mono" />
            </div>
          </div>
        </div>

        {/* Strategy Blueprint — live view of the exact simulation rules */}
        <StrategyBlueprint
          rsiPeriod={rsiPeriod} emaFast={emaFast} emaSlow={emaSlow} atrPeriod={atrPeriod}
          rsiOversold={rsiOversold} rsiOverbought={rsiOverbought}
          requireEma={requireEma} slMult={slMult} tpMult={tpMult}
          maxHoldBars={maxHoldBars} maxRiskPct={maxRiskPct}
          timeframe={timeframe}
        />

        <button
          onClick={handleRun}
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-accent text-white font-semibold text-sm hover:bg-accent/80 disabled:opacity-50 transition-colors">
          {loading ? '⏳ Running backtest…' : '▶ Run Backtest'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red/10 border border-red/30 rounded-lg px-4 py-3 text-sm text-red">
          {error}
        </div>
      )}

      {/* Results */}
      {result && stats && (
        <>
          {/* Summary header */}
          <div className="bg-surface border border-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-sm font-semibold text-text">
                    Backtest Results — {config.symbol} · {result.timeframe} · {result.result.barsTotal.toLocaleString()} bars
                  </h3>
                  {savedAt && (
                    <span className="text-[10px] font-mono text-muted/50 bg-surface3 px-2 py-0.5 rounded-full border border-border/40">
                      💾 saved {new Date(savedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted mt-0.5">
                  Warmup: {result.result.warmupBars} bars · {stats.totalTrades} trades simulated ·
                  Starting equity: ${startEquity.toLocaleString()}
                </p>
              </div>
              <div className={`text-2xl font-bold font-mono ${stats.totalPnl >= 0 ? 'text-green' : 'text-red'}`}>
                {fmt(stats.totalPnl)}
              </div>
            </div>

            {/* Stat grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              <StatCard label="Win Rate"
                value={pct(stats.winRate)}
                color={stats.winRate != null && stats.winRate >= 0.5 ? 'text-green' : 'text-red'}
                sub={`${stats.wins}W / ${stats.losses}L`} />
              <StatCard label="Total P&L"
                value={fmtUsd(stats.totalPnl)}
                color={stats.totalPnl >= 0 ? 'text-green' : 'text-red'} />
              <StatCard label="Profit Factor"
                value={dp2(stats.profitFactor)}
                color={stats.profitFactor != null && stats.profitFactor >= 1 ? 'text-green' : 'text-red'}
                sub="Gross win / Gross loss" />
              <StatCard label="Max Drawdown"
                value={`-$${stats.maxDrawdown.toFixed(0)}`}
                color="text-red"
                sub={`${stats.maxDrawdownPct.toFixed(1)}% of equity`} />
              <StatCard label="Sharpe Ratio"
                value={stats.sharpe != null ? stats.sharpe.toFixed(2) : '—'}
                color={stats.sharpe != null && stats.sharpe >= 1 ? 'text-green' : 'text-muted'}
                sub="Annualised" />
              <StatCard label="Avg Win"
                value={fmtUsd(stats.avgWin)}
                color="text-green" />
              <StatCard label="Avg Loss"
                value={stats.avgLoss != null ? `-$${stats.avgLoss.toFixed(2)}` : '—'}
                color="text-red" />
              <StatCard label="Risk / Reward"
                value={stats.riskReward != null ? `${stats.riskReward.toFixed(2)}:1` : '—'}
                color={stats.riskReward != null && stats.riskReward >= 1 ? 'text-green' : 'text-muted'} />
              <StatCard label="Expectancy"
                value={fmtUsd(stats.expectancy)}
                color={stats.expectancy >= 0 ? 'text-green' : 'text-red'}
                sub="Avg P&L per trade" />
              <StatCard label="Avg Hold"
                value={`${stats.avgBarsHeld.toFixed(0)} bars`}
                sub={`Max consec wins: ${stats.maxConsecWins}`} />
            </div>
          </div>

          {/* Equity curve */}
          {curve.length > 1 && (
            <div className="bg-surface border border-border rounded-lg p-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-4">Equity Curve</h4>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={curve} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="bt-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={stats.totalPnl >= 0 ? '#00e676' : '#f44336'} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={stats.totalPnl >= 0 ? '#00e676' : '#f44336'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a32" />
                  <XAxis dataKey="time" tick={false} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#888' }}
                    tickFormatter={v => `$${(v as number).toFixed(0)}`}
                    axisLine={false} tickLine={false} width={65}
                  />
                  <Tooltip
                    contentStyle={{ background: '#1a1a22', border: '1px solid #333', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: unknown) => [`$${(v as number).toFixed(2)}`, 'Equity']}
                    labelFormatter={l => new Date(l as string).toLocaleString()}
                  />
                  <ReferenceLine y={startEquity} stroke="#444" strokeDasharray="4 4" />
                  <Area
                    type="monotone" dataKey="equity"
                    stroke={stats.totalPnl >= 0 ? '#00e676' : '#f44336'}
                    strokeWidth={2} fill="url(#bt-grad)" dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Trade log */}
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setShowTrades(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-surface2/50 transition-colors">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Trade Log ({trades.length} trades)
              </span>
              <span className="text-muted2 text-xs">{showTrades ? '▲' : '▼'}</span>
            </button>

            {showTrades && (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface border-b border-border">
                    <tr>
                      {['Open Time', 'Dir', 'Entry', 'Exit', 'Result', 'P&L', 'Bars', 'RSI'].map(h => (
                        <th key={h} className="py-2 px-3 text-left text-muted font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => <TradeRow key={i} t={t} idx={i} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* AI Report */}
          <AIReport
            loading={reportLoading}
            error={reportError}
            report={report}
            model={reportModel}
            onRetry={() => result && fetchReport(result)}
          />
        </>
      )}
    </div>
  )
}
