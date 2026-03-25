// Wolf-Fin AgentProfileCard — human-readable "what does this agent do" card

import type { AgentState, AgentConfig } from '../types/index.ts'

// ── Behavior Summary (pure function) ─────────────────────────────────────────

export function deriveBehaviorSummary(config: AgentConfig): string {
  const parts: string[] = []

  // Market and account
  const mkt = config.market === 'mt5' ? 'MT5' : 'Crypto'
  const account = config.market === 'mt5' && config.mt5AccountId
    ? ` · Account #${config.mt5AccountId}`
    : ''
  parts.push(`${config.market === 'mt5' ? 'Forex' : 'Crypto'} ${config.symbol} on ${mkt}${account}.`)

  // Indicator summary
  const ind = config.indicatorConfig ?? {}
  const indList: string[] = [
    `RSI(${ind.rsiPeriod ?? 14})`,
    `EMA(${ind.emaFast ?? 20}/${ind.emaSlow ?? 50})`,
    `ATR(${ind.atrPeriod ?? 14})`,
    ind.vwapEnabled !== false ? 'VWAP' : null,
    ind.mtfEnabled  !== false ? 'MTF' : null,
    ind.macdEnabled ? 'MACD' : null,
    ind.adxEnabled  ? 'ADX' : null,
    ind.stochEnabled ? 'Stoch' : null,
  ].filter(Boolean) as string[]

  const tfs = config.candleConfig?.timeframes ?? ['m1', 'm5', 'm15', 'm30', 'h1', 'h4']
  parts.push(`Uses ${indList.join(', ')} on H1 with ${tfs.map(t => t.toUpperCase()).join('/')} confluence.`)

  // Risk profile
  const target = config.dailyTargetUsd ?? 500
  const risk   = config.maxRiskPercent  ?? 10
  parts.push(`Targets $${target}/day, ${risk}% risk per trade.`)

  // Schedule
  if (config.scheduledStartUtc && config.scheduledEndUtc) {
    parts.push(`Trades ${config.scheduledStartUtc}–${config.scheduledEndUtc} UTC.`)
  } else if (config.fetchMode === 'autonomous' || config.fetchMode === 'scheduled') {
    parts.push('Runs continuously (24/7).')
  }

  // Auto-pause conditions
  const pauses: string[] = []
  if (config.maxDailyLossUsd)      pauses.push(`$${config.maxDailyLossUsd} daily loss`)
  if (config.maxDrawdownPercent)   pauses.push(`${config.maxDrawdownPercent}% drawdown`)
  if (pauses.length > 0) parts.push(`Auto-pauses on ${pauses.join(' or ')}.`)

  return parts.join(' ')
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Chip({ label, active = true, dim = false }: { label: string; active?: boolean; dim?: boolean }) {
  if (!active) return null
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
      dim ? 'border-border text-muted2 bg-surface2'
          : 'border-green/40 text-green bg-green/10'
    }`}>
      {label}
    </span>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center text-xs py-1">
      <span className="text-muted">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} text-text font-medium`}>{value}</span>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface AgentProfileCardProps {
  agent: AgentState
  showBehaviorSummary?: boolean
}

export function AgentProfileCard({ agent, showBehaviorSummary = true }: AgentProfileCardProps) {
  const { config } = agent
  const ind  = config.indicatorConfig  ?? {}
  const ctx  = config.contextConfig    ?? {}
  const g    = config.guardrails       ?? {}
  const tfs  = config.candleConfig?.timeframes ?? ['m1', 'm5', 'm15', 'm30', 'h1', 'h4']

  const modeLabel = config.fetchMode === 'manual'     ? 'MANUAL'
                  : config.fetchMode === 'scheduled'  ? 'SCHEDULED'
                  : 'AUTONOMOUS'
  const modeColor = config.fetchMode === 'manual'     ? 'text-muted border-border'
                  : config.fetchMode === 'scheduled'  ? 'text-yellow border-yellow/40'
                  : 'text-green border-green/40'

  const hasWindow = config.scheduledStartUtc && config.scheduledEndUtc
  const windowStr = hasWindow
    ? `${config.scheduledStartUtc}–${config.scheduledEndUtc} UTC`
    : '24/7'

  const llmDisplay = (() => {
    const provider = config.llmProvider ?? 'anthropic'
    const model = config.llmModel ?? 'claude-sonnet-4-6'
    return `${provider}/${model.split('/').pop()}`
  })()

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* ── Row 1: Identity ──────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-text font-bold text-lg">{config.symbol}</span>
              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                config.market === 'mt5' ? 'text-blue border-blue/40 bg-blue/10' : 'text-yellow border-yellow/40 bg-yellow/10'
              }`}>{config.market.toUpperCase()}</span>
            </div>
            {config.name && (
              <span className="text-xs text-muted2">{config.name}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono text-muted border border-border rounded px-2 py-0.5">{llmDisplay}</span>
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${modeColor}`}>{modeLabel}</span>
        </div>
      </div>

      {/* ── Row 2: Schedule ──────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-b border-border">
        <div className="flex items-center gap-4 text-xs">
          <span className="text-muted">Window</span>
          <span className="text-text font-medium font-mono">{windowStr}</span>
          {config.leverage && (
            <>
              <span className="text-border">|</span>
              <span className="text-muted">Leverage</span>
              <span className="text-text font-medium">{config.leverage}:1</span>
            </>
          )}
        </div>
      </div>

      {/* ── Row 3: Risk Profile ───────────────────────────────────────────── */}
      <div className="px-5 py-3 border-b border-border">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted2 mb-2">Risk Profile</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-0">
          <Row label="Daily Target"   value={`$${config.dailyTargetUsd ?? 500}`} mono />
          <Row label="Max Risk/Trade" value={`${config.maxRiskPercent  ?? 10}%`} mono />
          <Row label="Max Daily Loss" value={config.maxDailyLossUsd    ? `$${config.maxDailyLossUsd}` : '—'} mono />
          <Row label="Max Drawdown"   value={config.maxDrawdownPercent ? `${config.maxDrawdownPercent}%` : '—'} mono />
        </div>
      </div>

      {/* ── Row 4: Data Inputs ────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-b border-border space-y-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted2">Data Inputs</div>

        {/* Indicators */}
        <div className="flex flex-wrap gap-1.5">
          <Chip label={`RSI(${ind.rsiPeriod ?? 14})`} />
          <Chip label={`EMA(${ind.emaFast ?? 20}/${ind.emaSlow ?? 50})`} />
          <Chip label={`ATR(${ind.atrPeriod ?? 14})`} />
          <Chip label="BB" />
          <Chip label="VWAP"  active={ind.vwapEnabled !== false} />
          <Chip label="MTF"   active={ind.mtfEnabled  !== false} />
          <Chip label="MACD"  active={!!ind.macdEnabled} />
          <Chip label="ADX"   active={!!ind.adxEnabled} />
          <Chip label="Stoch" active={!!ind.stochEnabled} />
        </div>

        {/* Timeframes */}
        <div className="flex flex-wrap gap-1.5">
          {tfs.map(tf => <Chip key={tf} label={tf.toUpperCase()} dim />)}
        </div>

        {/* Context signals */}
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {config.market === 'mt5' && (
            <span className={`px-2 py-0.5 rounded border ${ctx.economicCalendar !== false ? 'border-green/40 text-green bg-green/10' : 'border-border text-muted2 bg-surface2'}`}>
              {ctx.economicCalendar !== false ? '✓' : '✗'} Calendar
            </span>
          )}
          {config.market === 'mt5' && (
            <span className={`px-2 py-0.5 rounded border ${ctx.forexNews !== false ? 'border-green/40 text-green bg-green/10' : 'border-border text-muted2 bg-surface2'}`}>
              {ctx.forexNews !== false ? '✓' : '✗'} Forex News
            </span>
          )}
          {config.market === 'crypto' && (
            <>
              <span className={`px-2 py-0.5 rounded border ${ctx.fearGreed !== false ? 'border-green/40 text-green bg-green/10' : 'border-border text-muted2 bg-surface2'}`}>
                {ctx.fearGreed !== false ? '✓' : '✗'} Fear&amp;Greed
              </span>
              <span className={`px-2 py-0.5 rounded border ${ctx.news !== false ? 'border-green/40 text-green bg-green/10' : 'border-border text-muted2 bg-surface2'}`}>
                {ctx.news !== false ? '✓' : '✗'} Crypto News
              </span>
            </>
          )}
          <span className={`px-2 py-0.5 rounded border ${!!config.mcEnhancements?.markov || !!config.mcEnhancements?.bayesian ? 'border-green/40 text-green bg-green/10' : 'border-border text-muted2 bg-surface2'}`}>
            {!!config.mcEnhancements?.markov || !!config.mcEnhancements?.bayesian ? '✓' : '✗'} Monte Carlo
          </span>
        </div>
      </div>

      {/* ── Row 5: Guardrails ─────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-b border-border">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted2 mb-2">Guardrails</div>
        <div className="flex flex-wrap gap-3 text-[10px]">
          {(['sessionOpenCheck', 'extremeSpreadCheck', 'stopPipsRequired'] as const).map(k => {
            const enabled = g[k] !== false
            const label = k === 'sessionOpenCheck'   ? 'Session Check'
                        : k === 'extremeSpreadCheck' ? 'Spread Guard'
                        : 'SL Required'
            return (
              <span key={k} className={`flex items-center gap-1 ${enabled ? 'text-green' : 'text-muted2'}`}>
                <span>{enabled ? '✓' : '✗'}</span> {label}
              </span>
            )
          })}
        </div>
      </div>

      {/* ── Row 6: Behavior Summary ───────────────────────────────────────── */}
      {showBehaviorSummary && (
        <div className="px-5 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted2 mb-2">Behavior Summary</div>
          <p className="text-xs text-muted leading-relaxed">{deriveBehaviorSummary(config)}</p>
        </div>
      )}
    </div>
  )
}
