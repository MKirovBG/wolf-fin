import type { MarketState } from '../types/index.ts'

const REGIME_META: Record<string, { label: string; color: string; bg: string; border: string; desc: string }> = {
  trend:           { label: 'Trending',        color: 'text-green',    bg: 'bg-green/10',      border: 'border-green/30',    desc: 'Clear directional momentum with EMA alignment' },
  range:           { label: 'Ranging',          color: 'text-sky-400',  bg: 'bg-sky-400/10',    border: 'border-sky-400/20',  desc: 'Price oscillating between defined levels' },
  breakout_watch:  { label: 'Breakout Watch',   color: 'text-yellow',   bg: 'bg-yellow-dim',    border: 'border-yellow/30',   desc: 'Structure break detected — follow-through pending' },
  reversal_watch:  { label: 'Reversal Watch',   color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/20', desc: 'Overextension + reversal signals present' },
  volatile:        { label: 'Volatile',         color: 'text-red',      bg: 'bg-red/10',        border: 'border-red/30',      desc: 'Abnormal ATR — elevated risk, reduced structure' },
  compressed:      { label: 'Compressed',       color: 'text-muted',    bg: 'bg-surface2',      border: 'border-border',      desc: 'Tight BB + low ATR — energy building' },
}

const VOL_META: Record<string, { color: string; label: string }> = {
  low:      { color: 'text-muted',    label: 'Low' },
  normal:   { color: 'text-green',    label: 'Normal' },
  elevated: { color: 'text-yellow',   label: 'Elevated' },
  extreme:  { color: 'text-red',      label: 'Extreme' },
}

const SESSION_META: Record<string, { color: string; label: string }> = {
  optimal: { color: 'text-green',    label: 'Optimal' },
  good:    { color: 'text-green',    label: 'Good' },
  fair:    { color: 'text-yellow',   label: 'Fair' },
  poor:    { color: 'text-muted',    label: 'Poor' },
}

const RISK_META: Record<string, { color: string; bg: string; border: string; label: string }> = {
  low:      { color: 'text-green',  bg: 'bg-green/10',  border: 'border-green/20',  label: 'Low' },
  moderate: { color: 'text-yellow', bg: 'bg-yellow-dim', border: 'border-yellow/20', label: 'Moderate' },
  elevated: { color: 'text-red',    bg: 'bg-red/10',    border: 'border-red/20',    label: 'Elevated' },
  avoid:    { color: 'text-red',    bg: 'bg-red/20',    border: 'border-red/40',    label: 'AVOID' },
}

const DIR_COLORS: Record<string, string> = {
  bullish: 'text-green',
  bearish: 'text-red',
  neutral: 'text-yellow',
}

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000)    return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000)  return `${Math.floor(d / 60000)}m ago`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`
  return `${Math.floor(d / 86400000)}d ago`
}

function ReasonsBlock({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted2 mb-1.5 border-b border-border/40 pb-1">{title}</div>
      <ul className="space-y-1">
        {items.map((r, i) => (
          <li key={i} className="text-[11px] text-text/70 flex items-start gap-1.5">
            <span className="text-muted2 flex-shrink-0 mt-0.5">•</span>{r}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function MarketStatePanel({ state }: { state: MarketState }) {
  const regime   = REGIME_META[state.regime]  ?? REGIME_META.range
  const volMeta  = VOL_META[state.volatility]   ?? VOL_META.normal
  const sesMeta  = SESSION_META[state.sessionQuality] ?? SESSION_META.fair
  const riskMeta = RISK_META[state.contextRisk]  ?? RISK_META.low

  const allReasons = [
    ...state.trendReasons,
    ...state.rangeReasons,
    ...state.breakoutReasons,
    ...state.volatilityReasons,
    ...state.sessionReasons,
  ]

  return (
    <div className="space-y-3">

      {/* Regime hero card */}
      <div className={`border rounded-lg p-4 ${regime.bg} ${regime.border}`}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className={`text-base font-bold uppercase tracking-wider ${regime.color}`}>
              {regime.label}
            </div>
            <div className="text-xs text-text/70 mt-0.5">{regime.desc}</div>
          </div>
          {state.capturedAt && (
            <span className="text-[10px] text-muted2 flex-shrink-0">{rel(state.capturedAt)}</span>
          )}
        </div>

        {/* Direction + strength */}
        <div className="flex items-center gap-3 mt-3">
          <span className={`text-sm font-bold ${DIR_COLORS[state.direction] ?? 'text-muted'}`}>
            {state.direction === 'bullish' ? '▲' : state.direction === 'bearish' ? '▼' : '—'} {state.direction}
          </span>
          <div className="flex-1 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-bg/60 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  state.directionStrength >= 60 ? 'bg-green' :
                  state.directionStrength >= 35 ? 'bg-yellow' : 'bg-muted2'
                }`}
                style={{ width: `${state.directionStrength}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-muted flex-shrink-0">{state.directionStrength}%</span>
          </div>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-surface border border-border rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Volatility</div>
          <div className={`text-sm font-bold ${volMeta.color}`}>{volMeta.label}</div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Session</div>
          <div className={`text-sm font-bold ${sesMeta.color}`}>{sesMeta.label}</div>
        </div>
        <div className={`border rounded-lg p-3 text-center ${riskMeta.bg} ${riskMeta.border}`}>
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Context Risk</div>
          <div className={`text-sm font-bold ${riskMeta.color}`}>{riskMeta.label}</div>
        </div>
      </div>

      {/* Reasons */}
      {allReasons.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
          <ReasonsBlock title="Trend factors"     items={state.trendReasons} />
          <ReasonsBlock title="Range factors"     items={state.rangeReasons} />
          <ReasonsBlock title="Breakout signals"  items={state.breakoutReasons} />
          <ReasonsBlock title="Volatility"        items={state.volatilityReasons} />
          <ReasonsBlock title="Session"           items={state.sessionReasons} />
        </div>
      )}
    </div>
  )
}
