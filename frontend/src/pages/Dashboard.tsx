import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getStatus, getSummary } from '../api/client.ts'
import type { StatusResponse, AnalysisResult, WatchSymbol, SymbolSummary } from '../types/index.ts'
import { Card } from '../components/Card.tsx'
import { CalendarWidget } from '../components/CalendarWidget.tsx'

const BIAS_COLORS: Record<string, string> = {
  bullish: 'text-green',
  bearish: 'text-red',
  neutral: 'text-yellow',
}

const BIAS_ICONS: Record<string, string> = {
  bullish: '▲',
  bearish: '▼',
  neutral: '—',
}

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000)    return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000)  return `${Math.floor(d / 60000)}m ago`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`
  return `${Math.floor(d / 86400000)}d ago`
}

// ── Recent analysis card ──────────────────────────────────────────────────────

function AnalysisCard({ analysis }: { analysis: AnalysisResult }) {
  const { bias, summary, tradeProposal, symbol, timeframe, time, error } = analysis
  return (
    <Link
      to={`/symbols/${encodeURIComponent(analysis.symbolKey)}`}
      className="block bg-surface border border-border rounded-lg p-4 hover:border-muted2 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-text">{symbol}</span>
          <span className="text-[9px] bg-bg border border-border rounded px-1.5 py-0.5 font-mono text-muted uppercase">
            {timeframe}
          </span>
          {!error && (
            <span className={`text-xs font-medium ${BIAS_COLORS[bias] ?? 'text-muted'}`}>
              {BIAS_ICONS[bias]} {bias}
            </span>
          )}
          {error && <span className="text-xs text-red/70">Error</span>}
        </div>
        <span className="text-[10px] text-muted2 flex-shrink-0">{rel(time)}</span>
      </div>
      {!error && summary && (
        <p className="text-xs text-text/70 leading-snug line-clamp-2 mb-2">{summary}</p>
      )}
      {!error && tradeProposal && (
        <div className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded border ${
          tradeProposal.direction === 'BUY'
            ? 'text-green border-green/30 bg-green/10'
            : 'text-red border-red/30 bg-red/10'
        }`}>
          {tradeProposal.direction} · R:R {tradeProposal.riskReward.toFixed(2)} · {tradeProposal.confidence}
        </div>
      )}
    </Link>
  )
}

// ── Symbol summary row ────────────────────────────────────────────────────────

function SymbolRow({ sym, scheduled }: { sym: WatchSymbol; scheduled: boolean }) {
  return (
    <Link
      to={`/symbols/${encodeURIComponent(sym.key)}`}
      className="flex items-center justify-between px-3 py-2.5 hover:bg-surface2 transition-colors border-b border-border last:border-0"
    >
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${scheduled ? 'bg-green animate-pulse' : 'bg-muted2'}`} />
        <span className="font-mono text-sm text-text">{sym.symbol}</span>
        {sym.displayName && <span className="text-xs text-muted2">{sym.displayName}</span>}
      </div>
      <div className="flex items-center gap-2">
        {sym.lastAnalysisAt && (
          <span className="text-[10px] text-muted2">{rel(sym.lastAnalysisAt)}</span>
        )}
        <span className="text-muted text-xs">→</span>
      </div>
    </Link>
  )
}

// ── Bias heatmap ──────────────────────────────────────────────────────────────

const BIAS_BG: Record<string, string> = {
  bullish: 'border-green/40 bg-green/5',
  bearish: 'border-red/40 bg-red/5',
  neutral: 'border-yellow/30 bg-yellow/5',
}

const SCORE_COLOR = (score: number) => {
  if (score >= 70) return 'text-green'
  if (score >= 50) return 'text-yellow'
  return 'text-red'
}

function BiasCard({ s }: { s: SymbolSummary }) {
  const biasColor  = BIAS_COLORS[s.bias ?? 'neutral'] ?? 'text-muted'
  const biasIcon   = BIAS_ICONS[s.bias ?? 'neutral']  ?? '—'
  const borderCls  = s.error ? 'border-red/30 bg-red/5' : (BIAS_BG[s.bias ?? 'neutral'] ?? 'border-border')

  return (
    <Link
      to={`/symbols/${encodeURIComponent(s.key)}`}
      className={`block border rounded-lg p-3 hover:opacity-90 transition-opacity ${borderCls}`}
    >
      <div className="flex items-start justify-between gap-1 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {s.running && (
            <span className="w-1.5 h-1.5 rounded-full bg-yellow animate-pulse flex-shrink-0" />
          )}
          {!s.running && s.scheduled && (
            <span className="w-1.5 h-1.5 rounded-full bg-green/60 flex-shrink-0" />
          )}
          <span className="font-mono text-xs font-bold text-text truncate">{s.symbol}</span>
        </div>
        {!s.error && s.bias && (
          <span className={`text-xs font-bold flex-shrink-0 ${biasColor}`}>{biasIcon}</span>
        )}
        {s.error && <span className="text-[10px] text-red/70 flex-shrink-0">ERR</span>}
      </div>

      {!s.error && s.direction && (
        <div className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded border mb-1 ${
          s.direction === 'BUY'
            ? 'text-green border-green/30 bg-green/10'
            : 'text-red border-red/30 bg-red/10'
        }`}>
          {s.direction}
          {s.riskReward != null && ` · ${s.riskReward.toFixed(1)}R`}
          {s.validationScore != null && (
            <span className={`ml-1 ${SCORE_COLOR(s.validationScore)}`}>
              {s.validationScore}
            </span>
          )}
        </div>
      )}

      {s.lastAnalysisAt && (
        <div className="text-[9px] text-muted2">{rel(s.lastAnalysisAt)}</div>
      )}
    </Link>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export function Dashboard() {
  const [data, setData]         = useState<StatusResponse | null>(null)
  const [summary, setSummary]   = useState<SymbolSummary[]>([])
  const [lastUpdate, setLastUpdate] = useState('')

  const load = useCallback(async () => {
    try {
      const [statusData, summaryData] = await Promise.all([getStatus(), getSummary()])
      setData(statusData)
      setSummary(summaryData)
      setLastUpdate(new Date().toLocaleTimeString())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])

  // Poll every 30s
  useEffect(() => {
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  // SSE: refresh on new analysis
  useEffect(() => {
    const es = new EventSource('/api/analyses/stream')
    es.onmessage = () => load()
    return () => es.close()
  }, [load])

  const symbols      = data?.symbols ?? []
  const analyses     = data?.recentAnalyses ?? []
  const scheduled    = new Set(data?.scheduled ?? [])
  const bullish      = analyses.filter(a => a.bias === 'bullish' && !a.error).length
  const bearish      = analyses.filter(a => a.bias === 'bearish' && !a.error).length
  const withTrades   = analyses.filter(a => a.tradeProposal && !a.error).length

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text">Dashboard</h1>
          {lastUpdate && <p className="text-[11px] text-muted2 mt-0.5">Updated {lastUpdate}</p>}
        </div>
        <Link
          to="/symbols"
          className="px-3 py-1.5 bg-green/10 text-green text-sm font-medium rounded border border-green/30 hover:bg-green/20 transition-colors"
        >
          + Add Symbol
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Symbols',     value: symbols.length,  color: 'text-text' },
          { label: 'Scheduled',   value: scheduled.size,  color: 'text-green' },
          { label: 'Bullish',     value: bullish,         color: 'text-green' },
          { label: 'Trade Setups', value: withTrades,     color: 'text-yellow' },
        ].map(s => (
          <Card key={s.label}>
            <div className="text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted mt-1">{s.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Bias heatmap */}
      {summary.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Market Bias</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {summary.map(s => <BiasCard key={s.key} s={s} />)}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Watchlist */}
        <div className="lg:col-span-1">
          <Card>
            <div className="px-1 pb-3 border-b border-border mb-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">Watchlist</span>
                <Link to="/symbols" className="text-[10px] text-green hover:underline">Manage →</Link>
              </div>
            </div>
            {symbols.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted2">
                No symbols.<br />
                <Link to="/symbols" className="text-green hover:underline">Add one →</Link>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {symbols.map(sym => (
                  <SymbolRow key={sym.key} sym={sym} scheduled={scheduled.has(sym.key)} />
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Recent analyses */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Recent Analyses</span>
            <Link to="/reports" className="text-[10px] text-green hover:underline">All reports →</Link>
          </div>
          {analyses.length === 0 ? (
            <Card>
              <div className="py-8 text-center text-xs text-muted2">
                No analyses yet — run one from the Watchlist
              </div>
            </Card>
          ) : (
            analyses.slice(0, 6).map(a => (
              <AnalysisCard key={a.id} analysis={a} />
            ))
          )}
        </div>
      </div>

      {/* Calendar */}
      <CalendarWidget />
    </div>
  )
}
