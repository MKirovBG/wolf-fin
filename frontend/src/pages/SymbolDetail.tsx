import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  getSymbol, getAnalyses, triggerAnalysis, getLiveCandles,
  getLatestMarketState, getLatestSetups, getAlerts, getAlertFirings,
  getSymbolStrategies, addSymbolStrategy, removeSymbolStrategy,
  getStrategies, submitFeedback,
} from '../api/client.ts'
import type { WatchSymbol, AnalysisResult, CandleBar, MarketState, SetupCandidate, AlertRule, AlertFiring, SymbolStrategy, Strategy, TradeProposal, AnalysisContext } from '../types/index.ts'
import { CandlestickChart } from '../components/CandlestickChart.tsx'
import { MarketStatePanel } from '../components/MarketStatePanel.tsx'
import { SetupCandidatesPanel } from '../components/SetupCandidatesPanel.tsx'
import { AlertsPanel } from '../components/AlertsPanel.tsx'
import { useToast } from '../components/Toast.tsx'
import { Card } from '../components/Card.tsx'
import { useAccount } from '../contexts/AccountContext.tsx'

const TF_LABELS: Record<string, string> = {
  m1: '1M', m5: '5M', m15: '15M', m30: '30M', h1: '1H', h4: '4H',
}
const TF_FULL: Record<string, string> = {
  m1: '1-Minute', m5: '5-Minute', m15: '15-Minute', m30: '30-Minute', h1: '1-Hour', h4: '4-Hour',
}

const STRATEGY_LABELS: Record<string, string> = {
  price_action: 'Price Action',
  ict:          'ICT',
  trend:        'Trend Following',
  swing:        'Swing Trading',
  scalping:     'Scalping',
  smc:          'Smart Money',
}

const BIAS_COLORS: Record<string, string> = {
  bullish: 'text-green',
  bearish: 'text-red',
  neutral: 'text-yellow',
}
const BIAS_BG: Record<string, string> = {
  bullish: 'bg-green/10 border-green/20',
  bearish: 'bg-red/10 border-red/20',
  neutral: 'bg-yellow-dim border-yellow/20',
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high:   'text-green  bg-green/10  border-green/30',
  medium: 'text-yellow bg-yellow-dim border-yellow/30',
  low:    'text-muted  bg-surface2  border-border',
}
const LEVEL_COLORS: Record<string, string> = {
  support:    'text-green',
  resistance: 'text-red',
  pivot:      'text-purple-400',
}

// ── Indicator grouping ────────────────────────────────────────────────────────

const INDICATOR_GROUPS: { label: string; keys: string[] }[] = [
  { label: 'Oscillators',  keys: ['RSI(14)', 'Stoch %K', 'Stoch %D', 'CCI(20)', 'Williams %R', 'MFI(14)'] },
  { label: 'Trend',        keys: ['EMA Fast', 'EMA Slow', 'MACD', 'MACD Signal', 'MACD Hist', 'ADX(14)', '+DI', '-DI', 'PSAR', 'PSAR Trend', 'Ichi Conversion', 'Ichi Base', 'Ichi Cloud', 'Ichi Position'] },
  { label: 'Volatility',   keys: ['ATR(14)', 'BB Width', 'Keltner Upper', 'Keltner Mid', 'Keltner Lower'] },
  { label: 'Volume',       keys: ['VWAP', 'OBV', 'OBV Bias'] },
  { label: 'Multi-TF',     keys: ['MTF Score', 'M15 RSI', 'M15 EMA20', 'H4 RSI', 'H4 EMA20', 'H4 EMA50'] },
]

function groupIndicators(indicators: Record<string, number | string>) {
  const used = new Set<string>()
  const groups: { label: string; entries: [string, number | string][] }[] = []
  for (const g of INDICATOR_GROUPS) {
    const entries = g.keys.filter(k => k in indicators).map(k => [k, indicators[k]] as [string, number | string])
    if (entries.length) { groups.push({ label: g.label, entries }); entries.forEach(([k]) => used.add(k)) }
  }
  const rest = Object.entries(indicators).filter(([k]) => !used.has(k))
  if (rest.length) groups.push({ label: 'Other', entries: rest })
  return groups
}

function formatVal(v: number | string | null | undefined): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  return v.toFixed(Math.abs(v) < 10 ? 2 : v % 1 === 0 ? 0 : 2)
}

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000)   return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`
  return `${Math.floor(d / 86400000)}d ago`
}

// ── Analysis report ───────────────────────────────────────────────────────────

// ── Position Sizing Calculator ─────────────────────────────────────────────────

function PositionSizingCalc({ proposal, context }: { proposal: TradeProposal; context: AnalysisContext }) {
  const { accounts } = useAccount()
  const connected = accounts.filter(a => a.connected && a.summary?.balance)
  const si = context.symbolInfo

  const [riskPct, setRiskPct]     = useState(1)
  const [accountBal, setAccountBal] = useState(0)
  const [manualEntry, setManualEntry] = useState('')
  const [manualSl, setManualSl]   = useState('')

  // Auto-populate balance from first connected account
  useEffect(() => {
    if (connected.length > 0 && accountBal === 0) {
      setAccountBal(connected[0].summary?.balance ?? 0)
    }
  }, [connected, accountBal])

  const entry = manualEntry ? parseFloat(manualEntry) : (proposal.entryZone.low + proposal.entryZone.high) / 2
  const sl    = manualSl ? parseFloat(manualSl) : proposal.stopLoss
  const point = si?.point ?? 0.00001
  const digits = si?.digits ?? 5
  const contractSize = si?.contractSize ?? 100_000
  const volumeMin  = si?.volumeMin  ?? 0.01
  const volumeStep = si?.volumeStep ?? 0.01

  // Calculate pip distance & lot size
  const slDistPips = Math.abs(entry - sl) / (point * (digits === 3 || digits === 5 ? 10 : 1))
  const pipValue   = (point * (digits === 3 || digits === 5 ? 10 : 1)) * contractSize
  const riskAmount = accountBal * (riskPct / 100)
  const rawLots    = slDistPips > 0 ? riskAmount / (slDistPips * pipValue) : 0
  const lots       = Math.max(volumeMin, Math.floor(rawLots / volumeStep) * volumeStep)

  // Per-TP potential
  const tpResults = proposal.takeProfits.map((tp, i) => {
    const tpPips = Math.abs(tp - entry) / (point * (digits === 3 || digits === 5 ? 10 : 1))
    const tpPnl  = tpPips * pipValue * lots
    return { label: `TP${i + 1}`, pips: tpPips, pnl: tpPnl }
  })

  const potentialLoss = slDistPips * pipValue * lots

  if (!si || accountBal === 0) {
    return (
      <div className="border border-border/40 rounded-lg p-3 bg-surface2/30">
        <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">Position Sizing</div>
        <div className="text-xs text-muted2">
          {!si ? 'Symbol info unavailable — run analysis with MT5 connected.' : 'No connected account found.'}
        </div>
      </div>
    )
  }

  return (
    <div className="border border-brand/20 rounded-lg p-4 bg-brand/5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-brand">Position Sizing</span>
        <span className="text-[10px] text-muted2 font-mono">{contractSize.toLocaleString()} contract</span>
      </div>

      {/* Inputs row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Account Balance</label>
          <select
            value={accountBal}
            onChange={e => setAccountBal(parseFloat(e.target.value))}
            className="w-full text-xs font-mono bg-bg border border-border rounded px-2 py-1.5 text-text"
          >
            {connected.map(a => (
              <option key={a.id} value={a.summary?.balance ?? 0}>
                ${(a.summary?.balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} — #{a.summary?.login}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Risk %</label>
          <div className="flex items-center gap-1">
            {[0.5, 1, 2, 3].map(v => (
              <button
                key={v}
                onClick={() => setRiskPct(v)}
                className={`flex-1 text-[10px] py-1.5 rounded border font-medium transition-colors ${
                  riskPct === v ? 'bg-brand/10 text-brand border-brand/30' : 'bg-bg text-muted border-border hover:text-text'
                }`}
              >
                {v}%
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Entry Price</label>
          <input
            type="number"
            step="any"
            value={manualEntry || entry.toFixed(digits)}
            onChange={e => setManualEntry(e.target.value)}
            className="w-full text-xs font-mono bg-bg border border-border rounded px-2 py-1.5 text-text"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Stop Loss</label>
          <input
            type="number"
            step="any"
            value={manualSl || sl.toFixed(digits)}
            onChange={e => setManualSl(e.target.value)}
            className="w-full text-xs font-mono bg-bg border border-border rounded px-2 py-1.5 text-text"
          />
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-bg/60 rounded p-2 text-center">
          <div className="text-[10px] text-muted uppercase mb-0.5">Lot Size</div>
          <div className="font-mono text-sm font-bold text-brand">{lots.toFixed(2)}</div>
        </div>
        <div className="bg-bg/60 rounded p-2 text-center">
          <div className="text-[10px] text-muted uppercase mb-0.5">Risk $</div>
          <div className="font-mono text-sm font-bold text-red">${potentialLoss.toFixed(2)}</div>
        </div>
        <div className="bg-bg/60 rounded p-2 text-center">
          <div className="text-[10px] text-muted uppercase mb-0.5">SL Distance</div>
          <div className="font-mono text-sm font-bold text-text">{slDistPips.toFixed(1)} pips</div>
        </div>
        {tpResults.slice(0, 2).map(tp => (
          <div key={tp.label} className="bg-bg/60 rounded p-2 text-center">
            <div className="text-[10px] text-muted uppercase mb-0.5">{tp.label} Profit</div>
            <div className="font-mono text-sm font-bold text-green">+${tp.pnl.toFixed(2)}</div>
            <div className="text-[9px] text-muted2">{tp.pips.toFixed(1)} pips</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AnalysisReport({
  analysis, strategy, onRetry,
}: {
  analysis: AnalysisResult
  strategy?: string
  onRetry?: () => void
}) {
  const { bias, summary, keyLevels, tradeProposal, indicators, context, patterns, validation, reasoningChain, error } = analysis
  const [showIndicators, setShowIndicators] = useState(true)
  const [showContext, setShowContext]       = useState(true)
  const [showReasoning, setShowReasoning]   = useState(false)
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [feedbackRating, setFeedbackRating] = useState<number | null>(null)
  const [feedbackSent, setFeedbackSent]     = useState(false)
  const toast = useToast()

  if (error) {
    return (
      <div className="bg-red/10 border border-red/30 rounded-lg p-4">
        <div className="text-xs font-semibold text-red uppercase tracking-wider mb-1">Analysis Error</div>
        <div className="text-sm text-red/80 mb-3">{error}</div>
        {onRetry && (
          <button onClick={onRetry} className="px-3 py-1 text-xs text-red border border-red/30 rounded hover:bg-red/10 transition-colors">
            ↺ Retry Analysis
          </button>
        )}
      </div>
    )
  }

  const indicatorGroups = groupIndicators(indicators)

  return (
    <div className="space-y-3">

      {/* ── Bias + strategy + summary ── */}
      <div className={`border rounded-lg p-4 ${BIAS_BG[bias] ?? 'bg-surface border-border'}`}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center flex-wrap gap-2">
            <span className={`text-base font-bold uppercase tracking-wider ${BIAS_COLORS[bias] ?? 'text-muted'}`}>
              {bias === 'bullish' ? '▲' : bias === 'bearish' ? '▼' : '—'} {bias}
            </span>
            <span className="text-[10px] bg-bg/60 border border-border/60 rounded px-2 py-0.5 font-mono text-muted">
              {TF_FULL[analysis.timeframe] ?? analysis.timeframe}
            </span>
            {strategy && (
              <span className="text-[10px] bg-bg/60 border border-border/60 rounded px-2 py-0.5 text-purple-400">
                {STRATEGY_LABELS[strategy] ?? strategy}
              </span>
            )}
          </div>
          <span className="text-[10px] text-muted2 flex-shrink-0">{rel(analysis.time)}</span>
        </div>
        <p className="text-sm text-text leading-relaxed">{summary}</p>
      </div>

      {/* ── Trade proposal ── */}
      {tradeProposal && (
        <div className={`border rounded-lg p-4 ${tradeProposal.direction === 'BUY' ? 'border-green/30 bg-green/5' : 'border-red/30 bg-red/5'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold ${tradeProposal.direction === 'BUY' ? 'text-green' : 'text-red'}`}>
                {tradeProposal.direction === 'BUY' ? '▲ BUY' : '▼ SELL'} Setup
              </span>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${CONFIDENCE_COLORS[tradeProposal.confidence]}`}>
                {tradeProposal.confidence} confidence
              </span>
            </div>
            <span className="text-sm font-mono font-semibold text-text">R:R {tradeProposal.riskReward.toFixed(2)}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div className="bg-bg/40 rounded p-2">
              <div className="text-[10px] text-muted uppercase tracking-wider mb-1">Entry Zone</div>
              <div className="font-mono text-xs text-text leading-snug">
                {tradeProposal.entryZone.low.toFixed(5)}<br />
                {tradeProposal.entryZone.high.toFixed(5)}
              </div>
            </div>
            <div className="bg-bg/40 rounded p-2">
              <div className="text-[10px] text-muted uppercase tracking-wider mb-1">Stop Loss</div>
              <div className="font-mono text-xs text-red">{tradeProposal.stopLoss.toFixed(5)}</div>
            </div>
            {tradeProposal.takeProfits.map((tp, i) => (
              <div key={i} className="bg-bg/40 rounded p-2">
                <div className="text-[10px] text-muted uppercase tracking-wider mb-1">TP{i + 1}</div>
                <div className="font-mono text-xs text-green">{tp.toFixed(5)}</div>
              </div>
            ))}
          </div>

          <p className="text-xs text-text/80 leading-relaxed mb-2">{tradeProposal.reasoning}</p>
          {tradeProposal.invalidatedIf && (
            <div className="text-[11px] text-muted border-t border-border/40 pt-2 mt-2">
              <span className="text-muted2 font-medium">Invalidated if: </span>{tradeProposal.invalidatedIf}
            </div>
          )}
        </div>
      )}

      {/* ── Position sizing calculator ── */}
      {tradeProposal && tradeProposal.direction && (
        <PositionSizingCalc proposal={tradeProposal} context={context} />
      )}

      {/* ── Proposal validation ── */}
      {validation && tradeProposal && (
        <div className={`border rounded-lg p-3 ${validation.valid ? 'border-green/30 bg-green/5' : 'border-red/30 bg-red/5'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Proposal Quality</span>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-24 bg-bg rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${validation.score >= 70 ? 'bg-green' : validation.score >= 50 ? 'bg-yellow' : 'bg-red'}`}
                  style={{ width: `${validation.score}%` }}
                />
              </div>
              <span className={`text-xs font-bold font-mono ${validation.score >= 70 ? 'text-green' : validation.score >= 50 ? 'text-yellow' : 'text-red'}`}>
                {validation.score}/100
              </span>
            </div>
          </div>
          <div className="space-y-1">
            {validation.flags.map((flag, i) => (
              <div key={i} className="text-[11px] text-text/70 flex items-start gap-1.5">
                <span className={`flex-shrink-0 mt-0.5 ${
                  flag.startsWith('SL not') || flag.startsWith('Low R') || flag.startsWith('Trade direction CONTRA') || flag.startsWith('Low confidence') || flag.startsWith('Wide entry')
                    ? 'text-red/60' : 'text-green/60'
                }`}>{'•'}</span>
                {flag}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Candlestick patterns ── */}
      {patterns && patterns.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            Patterns Detected <span className="text-muted2 font-normal normal-case">({patterns.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {patterns.map((p, i) => (
              <div
                key={i}
                title={p.description}
                className={`text-[10px] font-medium px-2 py-0.5 rounded border ${
                  p.direction === 'bullish' ? 'text-green border-green/30 bg-green/10' :
                  p.direction === 'bearish' ? 'text-red border-red/30 bg-red/10' :
                  'text-muted border-border bg-surface2'
                }`}
              >
                {p.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Session ── */}
      {context.session && (
        <div className={`border rounded-lg px-3 py-2 flex items-center gap-2 ${
          context.session.isLondonNYOverlap
            ? 'border-green/30 bg-green/5'
            : context.session.isOptimalSession
              ? 'border-green/20 bg-green/[0.03]'
              : 'border-border bg-surface'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            context.session.activeSessions.length > 0 ? 'bg-green animate-pulse' : 'bg-muted2'
          }`} />
          <span className="text-[11px] text-text/70">{context.session.note}</span>
        </div>
      )}

      {/* ── Key levels ── */}
      {keyLevels.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
            Key Levels <span className="text-muted2 font-normal normal-case">({keyLevels.length})</span>
          </div>
          <div className="space-y-2">
            {keyLevels.map((level, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    level.type === 'support' ? 'bg-green' :
                    level.type === 'resistance' ? 'bg-red' : 'bg-purple-400'
                  }`} />
                  <span className={`font-medium ${LEVEL_COLORS[level.type] ?? 'text-muted'}`}>
                    {level.type.charAt(0).toUpperCase() + level.type.slice(1)}
                  </span>
                  {level.label && <span className="text-muted2">{level.label}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                    level.strength === 'strong'   ? 'text-yellow bg-yellow-dim border-yellow/30' :
                    level.strength === 'moderate' ? 'text-muted bg-surface2 border-border' :
                    'text-muted2 bg-bg border-border/50'
                  }`}>{level.strength}</span>
                  <span className="font-mono text-text">{level.price.toFixed(5)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Indicators (grouped, collapsible) ── */}
      {indicatorGroups.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowIndicators(s => !s)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface2 transition-colors"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Indicators</span>
            <span className="text-muted text-xs">{showIndicators ? '▲' : '▼'}</span>
          </button>
          {showIndicators && (
            <div className="px-4 pb-4 space-y-4">
              {indicatorGroups.map(group => (
                <div key={group.label}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted2 mb-2 border-b border-border/50 pb-1">
                    {group.label}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
                    {group.entries.map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between text-xs">
                        <span className="text-muted text-[10px] uppercase tracking-wider truncate mr-2">{k}</span>
                        <span className={`font-mono flex-shrink-0 ${
                          typeof v === 'string' && v === 'Bullish' ? 'text-green' :
                          typeof v === 'string' && v === 'Bearish' ? 'text-red' :
                          typeof v === 'string' && v === 'Rising'  ? 'text-green' :
                          typeof v === 'string' && v === 'Falling' ? 'text-red' :
                          typeof v === 'string' && v === 'Above'   ? 'text-green' :
                          typeof v === 'string' && v === 'Below'   ? 'text-red' :
                          'text-text'
                        }`}>{formatVal(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Market context (collapsible) ── */}
      {(context.news?.length || context.calendar?.length || context.session) ? (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowContext(s => !s)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface2 transition-colors"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Market Context</span>
            <span className="text-muted text-xs">{showContext ? '▲' : '▼'}</span>
          </button>
          {showContext && (
            <div className="px-4 pb-4 space-y-3">
              {context.news && context.news.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted2 mb-2 border-b border-border/50 pb-1">News Sentiment</div>
                  <div className="space-y-1.5">
                    {context.news.map((n, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className={`flex-shrink-0 text-[9px] px-1 py-0.5 rounded font-medium ${
                          n.sentiment === 'bullish' ? 'text-green bg-green/10' :
                          n.sentiment === 'bearish' ? 'text-red bg-red/10' : 'text-muted bg-surface2'
                        }`}>{n.sentiment.toUpperCase()}</span>
                        <span className="text-text/80 leading-snug">{n.headline}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {context.calendar && context.calendar.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted2 mb-2 border-b border-border/50 pb-1">Economic Events</div>
                  <div className="space-y-1.5">
                    {context.calendar.map((e, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className={`flex-shrink-0 text-[9px] px-1 py-0.5 rounded font-medium ${
                          e.impact === 'High'   ? 'text-red bg-red/10' :
                          e.impact === 'Medium' ? 'text-yellow bg-yellow-dim' : 'text-muted bg-surface2'
                        }`}>{e.impact}</span>
                        <span className="text-muted2 w-6 flex-shrink-0">{e.country}</span>
                        <span className="text-text/80 flex-1 truncate">{e.event}</span>
                        <span className="text-muted text-[10px] flex-shrink-0">{e.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {context.session && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted2 mb-2 border-b border-border/50 pb-1">Trading Session</div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      context.session.activeSessions.length > 0 ? 'bg-green animate-pulse' : 'bg-muted2'
                    }`} />
                    <span className="text-text/80">{context.session.note}</span>
                    {context.session.isLondonNYOverlap && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-green/10 text-green border border-green/30 font-medium">
                        London/NY Overlap
                      </span>
                    )}
                  </div>
                </div>
              )}
              {!context.news?.length && !context.calendar?.length && !context.session && (
                <p className="text-xs text-muted2">No market context data available for this analysis.</p>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* ── Reasoning chain ── */}
      {reasoningChain && reasoningChain.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowReasoning(r => !r)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted hover:bg-surface2 transition-colors"
          >
            <span>Reasoning Chain ({reasoningChain.length} steps)</span>
            <span className="text-muted2">{showReasoning ? '▼' : '▶'}</span>
          </button>
          {showReasoning && (
            <div className="px-4 pb-4 space-y-2">
              {reasoningChain.map((step, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-brand/10 border border-brand/30 flex items-center justify-center mt-0.5">
                    <span className="text-[9px] font-bold text-brand">{i + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-text">{step.step}</div>
                    <div className="text-[11px] text-muted leading-relaxed mt-0.5">{step.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── System prompt (collapsible) ── */}
      {analysis.systemPrompt && (
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowSystemPrompt(s => !s)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted hover:bg-surface2 transition-colors"
          >
            <span>System Prompt</span>
            <span className="text-muted2">{showSystemPrompt ? '▼' : '▶'}</span>
          </button>
          {showSystemPrompt && (
            <div className="px-4 pb-4">
              <pre className="text-[11px] text-text/80 leading-relaxed whitespace-pre-wrap font-mono bg-bg rounded-lg p-4 border border-border max-h-[400px] overflow-y-auto">
                {analysis.systemPrompt}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── Footer — LLM info + Feedback ── */}
      <div className="flex items-center justify-between text-[10px] text-muted2 px-1">
        <div className="flex items-center gap-2">
          <span className="bg-surface border border-border rounded px-1.5 py-0.5">{analysis.llmProvider}</span>
          <span className="font-mono">{analysis.llmModel}</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Feedback */}
          {!feedbackSent ? (
            <div className="flex items-center gap-1">
              <span className="text-muted2 mr-1">Rate:</span>
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={async () => {
                    setFeedbackRating(n)
                    setFeedbackSent(true)
                    try {
                      await submitFeedback(analysis.id, n, null)
                    } catch { /* silent */ }
                  }}
                  className={`w-5 h-5 rounded text-[10px] font-medium transition-colors ${
                    feedbackRating === n
                      ? 'bg-brand/20 text-brand border border-brand/40'
                      : 'bg-surface2 text-muted border border-border hover:text-text hover:border-brand/30'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-brand text-[10px]">Thanks for feedback</span>
          )}
          <span>{new Date(analysis.time).toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}

// ── History sidebar item ──────────────────────────────────────────────────────

function HistoryItem({ analysis, active, onClick }: {
  analysis: AnalysisResult
  active: boolean
  onClick: () => void
}) {
  const { bias } = analysis
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-border transition-colors ${
        active ? 'bg-surface2 border-l-2 border-l-green' : 'hover:bg-surface2'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${BIAS_COLORS[bias] ?? 'text-muted'}`}>
          {bias === 'bullish' ? '▲' : bias === 'bearish' ? '▼' : '—'} {bias}
        </span>
        <span className="text-[10px] text-muted2">{rel(analysis.time)}</span>
      </div>
      {analysis.strategyKey && (
        <div className="text-[10px] text-purple mt-0.5">
          {STRATEGY_LABELS[analysis.strategyKey] ?? analysis.strategyKey}
        </div>
      )}
      {analysis.tradeProposal && (
        <div className={`text-[10px] mt-0.5 font-medium ${analysis.tradeProposal.direction === 'BUY' ? 'text-green' : 'text-red'}`}>
          {analysis.tradeProposal.direction} · {analysis.tradeProposal.riskReward.toFixed(1)}R · {analysis.tradeProposal.confidence}
        </div>
      )}
      {analysis.error && <div className="text-[10px] text-red/70 mt-0.5">Error</div>}
      {!analysis.tradeProposal && !analysis.error && (
        <div className="text-[10px] text-muted mt-0.5">No trade setup</div>
      )}
    </button>
  )
}

// ── Tab type ──────────────────────────────────────────────────────────────────

type Tab = 'analysis' | 'setups' | 'state' | 'alerts'

// ── Main page ─────────────────────────────────────────────────────────────────

export function SymbolDetail() {
  const { key } = useParams<{ key: string }>()
  const decodedKey = key ? decodeURIComponent(key) : ''

  const [sym, setSym]                   = useState<WatchSymbol | null>(null)
  const [selected, setSelected]         = useState<AnalysisResult | null>(null)
  const [history, setHistory]           = useState<AnalysisResult[]>([])
  const [running, setRunning]           = useState(false)
  const [loading, setLoading]           = useState(true)
  const [showHistory, setShowHistory]   = useState(true)
  const [liveMode, setLiveMode]         = useState(false)
  const [chartTf, setChartTf]           = useState<string>('h1')
  const [liveCandles, setLiveCandles]   = useState<CandleBar[] | null>(null)
  const [liveError, setLiveError]       = useState<string | null>(null)
  const liveTimer                       = useRef<ReturnType<typeof setInterval> | null>(null)
  const toast                           = useToast()

  // Multi-strategy state
  const [assignedStrategies, setAssignedStrategies] = useState<SymbolStrategy[]>([])
  const [allStrategies, setAllStrategies]           = useState<Strategy[]>([])
  const [showStratPicker, setShowStratPicker]       = useState(false)
  const [stratFilter, setStratFilter]               = useState<string | null>(null) // filter analyses by strategy

  // Phase 2–5 state
  const [activeTab, setActiveTab]       = useState<Tab>('analysis')
  const [marketState, setMarketState]   = useState<MarketState | null>(null)
  const [setups, setSetups]             = useState<SetupCandidate[]>([])
  const [alertRules, setAlertRules]     = useState<AlertRule[]>([])
  const [alertFirings, setAlertFirings] = useState<AlertFiring[]>([])

  const loadPhaseData = useCallback(async () => {
    if (!decodedKey) return
    const [stateRes, setupsRes, rulesRes, firingsRes] = await Promise.allSettled([
      getLatestMarketState(decodedKey),
      getLatestSetups(decodedKey),
      getAlerts(decodedKey),
      getAlertFirings(decodedKey, 50),
    ])
    if (stateRes.status   === 'fulfilled') setMarketState(stateRes.value)
    if (setupsRes.status  === 'fulfilled') setSetups(setupsRes.value)
    if (rulesRes.status   === 'fulfilled') setAlertRules(rulesRes.value)
    if (firingsRes.status === 'fulfilled') setAlertFirings(firingsRes.value)
  }, [decodedKey])

  const load = useCallback(async () => {
    if (!decodedKey) return
    try {
      const [symData, hist, symStrats, allStrats] = await Promise.all([
        getSymbol(decodedKey),
        getAnalyses(decodedKey, 50),
        getSymbolStrategies(decodedKey).catch(() => [] as SymbolStrategy[]),
        getStrategies().catch(() => [] as Strategy[]),
      ])
      setSym(symData)
      setHistory(hist)
      setAssignedStrategies(symStrats)
      setAllStrategies(allStrats)
      if (hist.length > 0 && !selected) setSelected(hist[0])
      setChartTf(prev => prev === 'h1' ? (symData.candleConfig?.primaryTimeframe ?? 'h1') : prev)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setLoading(false)
    }
    loadPhaseData()
  }, [decodedKey, selected, toast, loadPhaseData])

  useEffect(() => { load() }, [load])

  // Live candle polling
  const fetchLive = useCallback(async () => {
    if (!decodedKey) return
    try {
      const candles = await getLiveCandles(decodedKey, chartTf, 200)
      setLiveCandles(candles)
      setLiveError(null)
    } catch (e) {
      setLiveError(String(e))
    }
  }, [decodedKey, chartTf])

  useEffect(() => {
    if (!liveMode) {
      if (liveTimer.current) { clearInterval(liveTimer.current); liveTimer.current = null }
      setLiveCandles(null)
      setLiveError(null)
      return
    }
    fetchLive()
    liveTimer.current = setInterval(fetchLive, 30_000)
    return () => {
      if (liveTimer.current) { clearInterval(liveTimer.current); liveTimer.current = null }
    }
  }, [liveMode, fetchLive])

  // SSE: listen for new analysis completions
  useEffect(() => {
    const es = new EventSource('/api/analyses/stream')
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type: string; symbolKey: string }
        if (event.symbolKey === decodedKey) {
          load()
          setRunning(false)
        }
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [decodedKey, load])

  const handleAddStrategy = async (stratKey: string) => {
    if (!decodedKey) return
    try {
      await addSymbolStrategy(decodedKey, stratKey)
      setAssignedStrategies(await getSymbolStrategies(decodedKey))
      setShowStratPicker(false)
      toast.success(`Strategy added`)
    } catch (e) {
      toast.error(String(e))
    }
  }

  const handleRemoveStrategy = async (stratKey: string) => {
    if (!decodedKey) return
    try {
      await removeSymbolStrategy(decodedKey, stratKey)
      setAssignedStrategies(await getSymbolStrategies(decodedKey))
      if (stratFilter === stratKey) setStratFilter(null)
    } catch (e) {
      toast.error(String(e))
    }
  }

  const handleAnalyze = async () => {
    if (!decodedKey) return
    try {
      await triggerAnalysis(decodedKey)
      setRunning(true)
      toast.info('Analysis started')
    } catch (e) {
      toast.error(String(e))
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted text-sm">Loading…</div>
  }
  if (!sym) {
    return (
      <div className="p-6 text-center">
        <div className="text-muted mb-2">Symbol not found</div>
        <Link to="/symbols" className="text-green text-sm">← Back to watchlist</Link>
      </div>
    )
  }

  const configUrl = `/symbols/${encodeURIComponent(decodedKey)}/config`
  const unackedCount = alertFirings.filter(f => !f.acknowledged).length
  const validSetups = setups.filter(s => s.found && s.tier === 'valid').length

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface flex-shrink-0 gap-3">
        {/* Left: breadcrumb + symbol info */}
        <div className="flex items-center gap-2 min-w-0">
          <Link to="/symbols" className="text-muted hover:text-text text-xs flex-shrink-0">← Watchlist</Link>
          <span className="text-muted2">/</span>
          <span className="font-mono text-sm font-bold text-text">{sym.symbol}</span>
          {sym.displayName && <span className="text-xs text-muted2 truncate">{sym.displayName}</span>}
          <span className="text-[10px] bg-bg border border-border rounded px-1.5 py-0.5 font-mono text-muted flex-shrink-0">
            {TF_FULL[sym.candleConfig?.primaryTimeframe ?? 'h1'] ?? 'H1'}
          </span>
          {sym.strategy && (
            <span className="text-[10px] bg-bg border border-border rounded px-1.5 py-0.5 text-purple-400 flex-shrink-0">
              {STRATEGY_LABELS[sym.strategy] ?? sym.strategy}
            </span>
          )}
          {marketState && (
            <span className={`text-[10px] rounded px-1.5 py-0.5 flex-shrink-0 font-medium ${
              marketState.regime === 'trend'          ? 'text-green bg-green/10 border border-green/20' :
              marketState.regime === 'volatile'       ? 'text-red bg-red/10 border border-red/20' :
              marketState.regime === 'breakout_watch' ? 'text-yellow bg-yellow-dim border border-yellow/20' :
              marketState.regime === 'reversal_watch' ? 'text-purple-400 bg-purple-400/10 border border-purple-400/20' :
              'text-muted bg-surface2 border border-border'
            }`}>
              {marketState.regime.replace('_', ' ')}
            </span>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {history.length > 0 && (
            <button
              onClick={() => setShowHistory(s => !s)}
              title={showHistory ? 'Hide history' : 'Show history'}
              className={`text-[10px] px-2.5 py-1.5 rounded border font-medium transition-colors ${
                showHistory
                  ? 'bg-surface2 text-text border-border'
                  : 'bg-surface text-muted border-border hover:text-text'
              }`}
            >
              ☰ History {history.length > 0 && <span className="text-muted2">({history.length})</span>}
            </button>
          )}
          <Link
            to={configUrl}
            className="text-[10px] px-2.5 py-1.5 rounded border border-border text-muted hover:text-text hover:bg-surface2 transition-colors font-medium"
          >
            ✎ Edit
          </Link>
          <button
            onClick={handleAnalyze}
            disabled={running}
            className="px-3 py-1.5 bg-green/10 text-green text-xs font-medium rounded border border-green/30 hover:bg-green/20 disabled:opacity-40 transition-colors"
          >
            {running ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
                Analyzing…
              </span>
            ) : '▶ Run Analysis'}
          </button>
        </div>
      </div>

      {/* ── Strategy bar ── */}
      {(assignedStrategies.length > 0 || sym.strategy) && (
        <div className="flex items-center gap-2 px-5 py-2 border-b border-border bg-surface flex-shrink-0 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted2 flex-shrink-0">Strategies</span>

          {/* Strategy filter chips */}
          <button
            onClick={() => setStratFilter(null)}
            className={`text-[10px] px-2 py-0.5 rounded border font-medium transition-colors ${
              stratFilter === null
                ? 'bg-brand/10 text-brand border-brand/30'
                : 'bg-surface2 text-muted border-border hover:text-text'
            }`}
          >
            All
          </button>
          {assignedStrategies.map(s => (
            <div key={s.strategyKey} className="flex items-center gap-0.5">
              <button
                onClick={() => setStratFilter(s.strategyKey)}
                className={`text-[10px] px-2 py-0.5 rounded-l border font-medium transition-colors ${
                  stratFilter === s.strategyKey
                    ? 'bg-purple/10 text-purple border-purple/30'
                    : 'bg-surface2 text-muted border-border hover:text-text'
                }`}
              >
                {STRATEGY_LABELS[s.strategyKey] ?? s.strategyKey}
              </button>
              <button
                onClick={() => handleRemoveStrategy(s.strategyKey)}
                className="text-[10px] px-1 py-0.5 rounded-r border border-l-0 border-border text-muted2 hover:text-red hover:bg-red/10 transition-colors"
                title="Remove strategy"
              >
                ×
              </button>
            </div>
          ))}

          {/* Add strategy button */}
          <div className="relative">
            <button
              onClick={() => setShowStratPicker(p => !p)}
              className="text-[10px] px-2 py-0.5 rounded border border-dashed border-border text-muted hover:text-text hover:border-brand/40 transition-colors"
            >
              + Add
            </button>
            {showStratPicker && (
              <div className="absolute top-full left-0 mt-1 w-48 bg-surface2 border border-border rounded-lg shadow-dropdown z-50 overflow-hidden">
                {allStrategies
                  .filter(s => !assignedStrategies.some(a => a.strategyKey === s.key))
                  .map(s => (
                    <button
                      key={s.key}
                      onClick={() => handleAddStrategy(s.key)}
                      className="w-full text-left px-3 py-2 text-xs text-text hover:bg-surface3 transition-colors border-b border-border/40 last:border-0"
                    >
                      <div className="font-medium">{s.name}</div>
                      {s.description && <div className="text-[10px] text-muted2 mt-0.5 truncate">{s.description}</div>}
                    </button>
                  ))}
                {allStrategies.filter(s => !assignedStrategies.some(a => a.strategyKey === s.key)).length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted2 text-center">All strategies assigned</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Main area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-w-0">

          {/* Chart header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {(['m1','m5','m15','m30','h1','h4'] as const).map(tf => (
                <button
                  key={tf}
                  onClick={() => { setChartTf(tf); setLiveMode(true) }}
                  className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium transition-colors ${
                    chartTf === tf && liveMode
                      ? 'bg-green/10 text-green border border-green/30'
                      : 'text-muted border border-transparent hover:border-border hover:text-text'
                  }`}
                >
                  {TF_LABELS[tf]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {liveMode && (
                <span className="flex items-center gap-1 text-[10px] text-muted">
                  <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
                  Live · MT5
                </span>
              )}
              <button
                onClick={() => setLiveMode(m => !m)}
                className={`text-[10px] px-2.5 py-1 rounded border font-medium transition-colors ${
                  liveMode
                    ? 'bg-green/10 text-green border-green/30 hover:bg-green/20'
                    : 'bg-surface text-muted border-border hover:text-text'
                }`}
              >
                {liveMode ? '◉ Live' : '○ Live'}
              </button>
            </div>
          </div>

          {/* Chart */}
          {liveMode ? (
            liveError ? (
              <div className="h-64 border border-red/30 rounded-lg flex items-center justify-center bg-surface">
                <span className="text-xs text-red/80">{liveError}</span>
              </div>
            ) : liveCandles && liveCandles.length > 0 ? (
              <CandlestickChart
                candles={liveCandles}
                keyLevels={selected?.keyLevels ?? []}
                proposal={selected?.tradeProposal ?? null}
                currentPrice={selected?.context.currentPrice?.mid}
              />
            ) : (
              <div className="h-64 border border-border rounded-lg flex items-center justify-center text-muted text-sm bg-surface">
                Loading live candles…
              </div>
            )
          ) : selected && selected.candles.length > 0 ? (
            <CandlestickChart
              candles={selected.candles}
              keyLevels={selected.keyLevels}
              proposal={selected.tradeProposal}
              currentPrice={selected.context.currentPrice?.mid}
            />
          ) : (
            <div className="h-64 border border-border rounded-lg flex items-center justify-center text-muted text-sm bg-surface">
              {history.length === 0
                ? 'Run an analysis to load chart data'
                : 'No candle data in this analysis'}
            </div>
          )}

          {/* ── Tab bar ── */}
          <div className="flex items-center gap-0 border-b border-border -mx-4 px-4">
            {([
              { id: 'analysis', label: 'Analysis' },
              { id: 'setups',   label: `Setups${validSetups > 0 ? ` (${validSetups})` : ''}` },
              { id: 'state',    label: 'Market State' },
              { id: 'alerts',   label: `Alerts${unackedCount > 0 ? ` (${unackedCount})` : ''}` },
            ] as { id: Tab; label: string }[]).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`text-xs px-3 py-2 -mb-px border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'text-green border-green'
                    : 'text-muted border-transparent hover:text-text'
                }`}
              >
                {tab.label}
                {tab.id === 'alerts' && unackedCount > 0 && (
                  <span className="ml-1 w-1.5 h-1.5 rounded-full bg-yellow inline-block" />
                )}
              </button>
            ))}
          </div>

          {/* ── Tab content ── */}

          {activeTab === 'analysis' && (() => {
            // When multi-strategy is active and a filter is set, show all analyses for that strategy
            if (stratFilter && assignedStrategies.length > 0) {
              const filtered = history.filter(a => a.strategyKey === stratFilter)
              if (filtered.length === 0) {
                return (
                  <Card>
                    <div className="text-center py-8 text-muted text-sm">
                      No analyses yet for {STRATEGY_LABELS[stratFilter] ?? stratFilter} — click "▶ Run Analysis"
                    </div>
                  </Card>
                )
              }
              return (
                <div className="space-y-4">
                  <div className="text-xs text-muted2 font-medium uppercase tracking-wider">
                    {STRATEGY_LABELS[stratFilter] ?? stratFilter} — {filtered.length} analysis(es)
                  </div>
                  <AnalysisReport analysis={filtered[0]} strategy={stratFilter} onRetry={handleAnalyze} />
                </div>
              )
            }

            // When multi-strategy, no filter → show latest per strategy
            if (assignedStrategies.length > 0 && !stratFilter) {
              const latestPerStrategy = assignedStrategies.map(s => {
                const latest = history.find(a => a.strategyKey === s.strategyKey)
                return { strategyKey: s.strategyKey, analysis: latest }
              }).filter(x => x.analysis)

              if (latestPerStrategy.length > 0) {
                return (
                  <div className="space-y-5">
                    {latestPerStrategy.map(({ strategyKey, analysis }) => (
                      <div key={strategyKey}>
                        <div className="text-xs text-purple font-medium uppercase tracking-wider mb-2 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple" />
                          {STRATEGY_LABELS[strategyKey] ?? strategyKey}
                        </div>
                        <AnalysisReport analysis={analysis!} strategy={strategyKey} onRetry={handleAnalyze} />
                      </div>
                    ))}
                  </div>
                )
              }
            }

            // Default: single strategy or no strategies assigned
            return selected ? (
              <AnalysisReport analysis={selected} strategy={selected.strategyKey ?? sym.strategy} onRetry={handleAnalyze} />
            ) : (
              <Card>
                <div className="text-center py-8 text-muted text-sm">
                  No analysis yet — click "▶ Run Analysis" to get started
                </div>
              </Card>
            )
          })()}

          {activeTab === 'setups' && (
            <SetupCandidatesPanel candidates={setups} />
          )}

          {activeTab === 'state' && (
            marketState ? (
              <MarketStatePanel state={marketState} />
            ) : (
              <div className="bg-surface border border-border rounded-lg p-6 text-center text-sm text-muted">
                No market state data — run an analysis first
              </div>
            )
          )}

          {activeTab === 'alerts' && (
            <AlertsPanel
              symbolKey={decodedKey}
              rules={alertRules}
              firings={alertFirings}
              onRefresh={loadPhaseData}
            />
          )}
        </div>

        {/* History sidebar */}
        {showHistory && history.length > 0 && (
          <div className="w-52 flex-shrink-0 border-l border-border flex flex-col overflow-hidden">
            <div className="px-3 py-2.5 border-b border-border flex-shrink-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                History ({history.length})
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {history
                .filter(a => !stratFilter || a.strategyKey === stratFilter)
                .map(a => (
                <HistoryItem
                  key={a.id}
                  analysis={a}
                  active={selected?.id === a.id}
                  onClick={() => { setSelected(a); setActiveTab('analysis') }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
