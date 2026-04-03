import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getStatus, getSummary, getLiveCandles } from '../api/client.ts'
import type { StatusResponse, SymbolSummary, CandleBar } from '../types/index.ts'
import { Card } from '../components/Card.tsx'
import { CalendarWidget } from '../components/CalendarWidget.tsx'
import { AgentStatePanel } from '../components/AgentStatePanel.tsx'
import { MiniChart } from '../components/MiniChart.tsx'

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

const SCORE_COLOR = (score: number) => {
  if (score >= 70) return 'text-green'
  if (score >= 50) return 'text-yellow'
  return 'text-red'
}

// ── Watchlist card (grid) ─────────────────────────────────────────────────────

function WatchlistCard({ s }: { s: SymbolSummary }) {
  const [candles, setCandles] = useState<CandleBar[]>([])

  useEffect(() => {
    getLiveCandles(s.key, 'h1', 60).then(setCandles).catch(() => {})
  }, [s.key])

  const biasColor = BIAS_COLORS[s.bias ?? 'neutral'] ?? 'text-muted'
  const biasIcon  = BIAS_ICONS[s.bias ?? 'neutral']  ?? '—'

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden hover:border-muted2 transition-colors group">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-2 min-w-0">
          {s.running && (
            <span className="w-1.5 h-1.5 rounded-full bg-yellow animate-pulse flex-shrink-0" />
          )}
          {!s.running && s.scheduled && (
            <span className="w-1.5 h-1.5 rounded-full bg-green/60 flex-shrink-0" />
          )}
          <span className="font-mono text-sm font-bold text-text truncate">{s.symbol}</span>
          {s.displayName && (
            <span className="text-[10px] text-muted2 truncate hidden sm:inline">{s.displayName}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!s.error && s.bias && (
            <span className={`text-xs font-bold ${biasColor}`}>{biasIcon} {s.bias}</span>
          )}
          {s.error && <span className="text-[10px] text-red/70">ERR</span>}
        </div>
      </div>

      {/* Mini chart */}
      <div className="px-2">
        <Link to={`/symbols/${encodeURIComponent(s.key)}`}>
          {candles.length > 0 ? (
            <MiniChart candles={candles} height={110} />
          ) : (
            <div className="h-[110px] flex items-center justify-center text-[10px] text-muted2">
              {s.error ? 'Chart unavailable' : 'Loading chart...'}
            </div>
          )}
        </Link>
      </div>

      {/* Analysis summary */}
      <div className="px-4 py-2.5 space-y-1.5">
        {!s.error && s.direction && (
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${
              s.direction === 'BUY'
                ? 'text-green border-green/30 bg-green/10'
                : 'text-red border-red/30 bg-red/10'
            }`}>
              {s.direction}
              {s.riskReward != null && ` · ${s.riskReward.toFixed(1)}R`}
            </span>
            {s.confidence && (
              <span className={`text-[10px] ${
                s.confidence === 'high' ? 'text-green' : s.confidence === 'medium' ? 'text-yellow' : 'text-muted'
              }`}>
                {s.confidence}
              </span>
            )}
            {s.validationScore != null && (
              <span className={`text-[10px] font-mono ${SCORE_COLOR(s.validationScore)}`}>
                {s.validationScore}pts
              </span>
            )}
          </div>
        )}

        {s.summary && !s.error && (
          <p className="text-[11px] text-muted leading-snug line-clamp-2">{s.summary}</p>
        )}

        {/* Footer: timestamp + actions */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-muted2">
            {s.lastAnalysisAt ? rel(s.lastAnalysisAt) : 'No analysis yet'}
          </span>
          <div className="flex items-center gap-1.5">
            <Link
              to={`/symbols/${encodeURIComponent(s.key)}`}
              className="text-[10px] px-2 py-0.5 rounded border border-border text-muted hover:text-text hover:bg-surface2 transition-colors"
            >
              View
            </Link>
            <Link
              to={`/symbols/${encodeURIComponent(s.key)}/config`}
              className="text-[10px] px-2 py-0.5 rounded border border-border text-muted hover:text-text hover:bg-surface2 transition-colors"
            >
              Edit
            </Link>
          </div>
        </div>
      </div>
    </div>
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
  const scheduled    = new Set(data?.scheduled ?? [])
  const bullish      = summary.filter(s => s.bias === 'bullish' && !s.error).length
  const withTrades   = summary.filter(s => s.direction && !s.error).length

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
          { label: 'Symbols',      value: symbols.length,  color: 'text-text' },
          { label: 'Scheduled',    value: scheduled.size,  color: 'text-green' },
          { label: 'Bullish',      value: bullish,         color: 'text-green' },
          { label: 'Trade Setups', value: withTrades,      color: 'text-yellow' },
        ].map(s => (
          <Card key={s.label}>
            <div className="text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted mt-1">{s.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Watchlist grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Watchlist</span>
          <Link to="/symbols" className="text-[10px] text-green hover:underline">Manage →</Link>
        </div>
        {summary.length === 0 ? (
          <Card>
            <div className="py-10 text-center text-sm text-muted2">
              No symbols in your watchlist.<br />
              <Link to="/symbols" className="text-green hover:underline mt-1 inline-block">Add one →</Link>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {summary.map(s => <WatchlistCard key={s.key} s={s} />)}
          </div>
        )}
      </div>

      {/* Agent state + Calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AgentStatePanel />
        <CalendarWidget />
      </div>
    </div>
  )
}
