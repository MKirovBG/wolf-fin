import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getStatus, getSummary, getLiveCandles, getAccountSnapshots } from '../api/client.ts'
import type { StatusResponse, SymbolSummary, CandleBar } from '../types/index.ts'
import { Card } from '../components/Card.tsx'
import { CalendarWidget } from '../components/CalendarWidget.tsx'
import { AgentStatePanel } from '../components/AgentStatePanel.tsx'
import { MiniChart } from '../components/MiniChart.tsx'
import { useAccount } from '../contexts/AccountContext.tsx'

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

// ── Equity Curve Widget ───────────────────────────────────────────────────────

function EquityCurveWidget() {
  const { accounts } = useAccount()
  const connected = accounts.find(a => a.connected && a.summary?.login)
  const login = connected?.summary?.login
  const [snapshots, setSnapshots] = useState<Array<{ balance: number; equity: number; takenAt: string }>>([])

  useEffect(() => {
    if (!login) return
    // Load last 7 days of snapshots
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    getAccountSnapshots(login, since).then(setSnapshots).catch(() => {})
  }, [login])

  if (!login || snapshots.length < 2) {
    return (
      <Card>
        <div className="text-center py-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Equity Curve</div>
          <div className="text-[11px] text-muted2">
            {!login ? 'Connect an MT5 account to see equity curve' : 'Collecting snapshots… check back soon'}
          </div>
        </div>
      </Card>
    )
  }

  const balances = snapshots.map(s => s.equity)
  const minBal = Math.min(...balances)
  const maxBal = Math.max(...balances)
  const range = maxBal - minBal || 1
  const first = balances[0]
  const last = balances[balances.length - 1]
  const pnl = last - first
  const pnlPct = ((pnl / first) * 100)

  // SVG line chart
  const w = 400
  const h = 80
  const points = snapshots.map((s, i) => {
    const x = (i / (snapshots.length - 1)) * w
    const y = h - ((s.equity - minBal) / range) * (h - 10) - 5
    return `${x},${y}`
  }).join(' ')

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">Equity Curve</span>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-text">${last.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          <span className={`text-[10px] font-mono font-bold ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
            {pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
        <defs>
          <linearGradient id="eqGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={pnl >= 0 ? '#00E676' : '#FF5252'} stopOpacity="0.3" />
            <stop offset="100%" stopColor={pnl >= 0 ? '#00E676' : '#FF5252'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`0,${h} ${points} ${w},${h}`}
          fill="url(#eqGrad)"
        />
        <polyline
          points={points}
          fill="none"
          stroke={pnl >= 0 ? '#00E676' : '#FF5252'}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex justify-between text-[9px] text-muted2 mt-1">
        <span>{snapshots[0].takenAt.slice(5, 10)}</span>
        <span>{snapshots[snapshots.length - 1].takenAt.slice(5, 10)}</span>
      </div>
    </Card>
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

      {/* Equity curve */}
      <EquityCurveWidget />

      {/* Agent state + Calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AgentStatePanel />
        <CalendarWidget />
      </div>
    </div>
  )
}
