import { useState, useEffect } from 'react'
import { analyzeAgent, getPromptAnalysis, getLatestMC } from '../api/client.ts'
import type { AgentState, AgentAnalysisResult, MCResultData } from '../types/index.ts'

// ── Diagram helpers ───────────────────────────────────────────────────────────

interface DiagramNode {
  id: string
  label: string
  sub?: string
  type: 'input' | 'memory' | 'core' | 'decision' | 'action' | 'guardrail'
}

function buildDiagram(agent: AgentState): {
  inputs: DiagramNode[]
  memory: DiagramNode[]
  decisions: DiagramNode[]
  actions: DiagramNode[]
  guardrails: DiagramNode[]
} {
  const { config } = agent
  const isCrypto = config.market === 'crypto'
  const isMt5    = config.market === 'mt5'

  const inputs: DiagramNode[] = [
    { id: 'price',   label: 'Live Price Feed',     sub: 'Bid / Ask / Spread',         type: 'input' },
    { id: 'candles', label: 'OHLCV Candles',        sub: 'Historical bars',             type: 'input' },
    { id: 'orders',  label: 'Open Positions',        sub: 'Current exposure',            type: 'input' },
  ]
  if (isCrypto) inputs.push({ id: 'ob', label: 'Order Book', sub: 'Depth & liquidity', type: 'input' })
  if (isCrypto) inputs.push({ id: 'fg', label: 'Fear & Greed', sub: 'Sentiment index', type: 'input' })
  if (isMt5)    inputs.push({ id: 'sess', label: 'Session Check', sub: 'Market hours', type: 'input' })
  inputs.push({ id: 'cal', label: 'Economic Calendar', sub: 'High-impact events', type: 'input' })
  if (isCrypto) inputs.push({ id: 'news', label: 'Crypto News', sub: 'Live news feed', type: 'input' })
  if (isMt5)    inputs.push({ id: 'fnews', label: 'Forex News', sub: 'Finnhub feed', type: 'input' })

  const memory: DiagramNode[] = [
    { id: 'strategy', label: 'Trading Strategy', sub: 'Rules & edge', type: 'memory' },
    { id: 'history',  label: 'Session History',  sub: 'Prior ticks',  type: 'memory' },
    { id: 'mem',      label: 'Persistent Memory', sub: 'Learned facts', type: 'memory' },
    { id: 'plan',     label: 'Session Plan',       sub: 'Daily bias',   type: 'memory' },
  ]

  const decisions: DiagramNode[] = [
    { id: 'long',   label: 'Open Long',      sub: 'Buy the market',     type: 'decision' },
    { id: 'short',  label: 'Open Short',     sub: 'Sell the market',    type: 'decision' },
    { id: 'close',  label: 'Close Position', sub: 'Exit trade',         type: 'decision' },
    { id: 'hold',   label: 'Hold & Monitor', sub: 'No action yet',      type: 'decision' },
    { id: 'adjust', label: 'Adjust Position', sub: 'Move SL / TP',      type: 'decision' },
  ]

  const actions: DiagramNode[] = [
    { id: 'order',   label: 'Place Market Order', sub: 'Instant execution',      type: 'action' },
    { id: 'sl',      label: 'Set Stop Loss',       sub: 'Capital protection',     type: 'action' },
    { id: 'tp',      label: 'Set Take Profit',     sub: 'Lock in target',         type: 'action' },
    { id: 'partial', label: 'Partial Close',        sub: 'Risk reduction',         type: 'action' },
    { id: 'modify',  label: 'Modify Order',         sub: 'Trail stop / adjust TP', type: 'action' },
  ]

  const guardrails: DiagramNode[] = []
  if (config.maxDailyLossUsd)   guardrails.push({ id: 'g1', label: 'Max Daily Loss',   sub: `$${config.maxDailyLossUsd} → auto-pause`,  type: 'guardrail' })
  if (config.maxDrawdownPercent) guardrails.push({ id: 'g2', label: 'Max Drawdown',     sub: `${config.maxDrawdownPercent}% → auto-pause`, type: 'guardrail' })
  if (config.maxRiskPercent)     guardrails.push({ id: 'g3', label: 'Max Risk / Trade', sub: `${config.maxRiskPercent}% of equity`,       type: 'guardrail' })
  if (config.dailyTargetUsd)     guardrails.push({ id: 'g4', label: 'Daily Target',     sub: `$${config.dailyTargetUsd} → stop trading`,  type: 'guardrail' })
  if (guardrails.length === 0)   guardrails.push({ id: 'g0', label: 'No hard guardrails', sub: 'Manual oversight only', type: 'guardrail' })

  return { inputs, memory, decisions, actions, guardrails }
}

// ── Node colours ──────────────────────────────────────────────────────────────

const NODE_STYLES: Record<DiagramNode['type'], { border: string; bg: string; label: string; dot: string }> = {
  input:     { border: 'border-blue-500/40',   bg: 'bg-blue-500/8',   label: 'text-blue-400',   dot: 'bg-blue-400' },
  memory:    { border: 'border-purple-500/40', bg: 'bg-purple-500/8', label: 'text-purple-400', dot: 'bg-purple-400' },
  core:      { border: 'border-green/60',      bg: 'bg-green/10',     label: 'text-green',      dot: 'bg-green' },
  decision:  { border: 'border-yellow-500/40', bg: 'bg-yellow-500/8', label: 'text-yellow-400', dot: 'bg-yellow-400' },
  action:    { border: 'border-accent/40',     bg: 'bg-accent/8',     label: 'text-accent',     dot: 'bg-accent' },
  guardrail: { border: 'border-red/40',        bg: 'bg-red/8',        label: 'text-red',        dot: 'bg-red' },
}

function DiagramCard({ node }: { node: DiagramNode }) {
  const s = NODE_STYLES[node.type]
  return (
    <div className={`rounded-lg border ${s.border} ${s.bg} px-3 py-2.5 flex items-start gap-2.5 min-w-0`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} mt-1.5 flex-shrink-0`} />
      <div className="min-w-0">
        <div className={`text-xs font-semibold ${s.label} leading-tight`}>{node.label}</div>
        {node.sub && <div className="text-xs text-muted mt-0.5 leading-tight">{node.sub}</div>}
      </div>
    </div>
  )
}

function DiagramColumn({ title, color, nodes }: { title: string; color: string; nodes: DiagramNode[] }) {
  return (
    <div className="flex flex-col gap-2 flex-shrink-0 w-44">
      <div className={`text-xs font-bold uppercase tracking-widest ${color} mb-1 text-center whitespace-nowrap`}>{title}</div>
      <div className="flex flex-col gap-2">
        {nodes.map(n => <DiagramCard key={n.id} node={n} />)}
      </div>
    </div>
  )
}

// Horizontal arrow — self-start + pt aligns it next to the first card in adjacent columns
function HArrow() {
  return (
    <div className="flex-shrink-0 flex items-center self-start pt-7">
      <div className="w-4 h-px bg-border/60" />
      <svg width="5" height="8" viewBox="0 0 5 8" className="text-border/60 flex-shrink-0">
        <path d="M0 0 L5 4 L0 8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function AgentCoreNode({ agent }: { agent: AgentState }) {
  const provider      = agent.config.llmProvider ?? 'anthropic'
  const model         = agent.config.llmModel ?? (provider === 'anthropic' ? 'Claude (default)' : provider === 'openrouter' ? 'OpenRouter model' : 'Local model')
  const providerLabel = provider === 'anthropic' ? 'Anthropic Claude' : provider === 'openrouter' ? 'OpenRouter' : 'Ollama Local'

  return (
    <div className="flex-shrink-0 w-44">
      <div className="text-xs font-bold uppercase tracking-widest text-green mb-1 text-center">AI Engine</div>
      <div className="rounded-xl border-2 border-green/60 bg-green/10 p-4 flex flex-col items-center gap-2.5 text-center shadow-lg shadow-green/10">
        <div className="w-10 h-10 rounded-full border-2 border-green/60 bg-green/20 flex items-center justify-center text-xl">🤖</div>
        <div>
          <div className="text-sm font-bold text-green">{providerLabel}</div>
          <div className="text-xs text-muted mt-1 font-mono leading-snug break-all">{model}</div>
        </div>
        <div className="w-full border-t border-green/20 pt-2 text-xs text-muted">
          {agent.config.symbol} · {agent.config.market.toUpperCase()}
          {agent.config.leverage ? ` · ${agent.config.leverage}×` : ''}
        </div>
      </div>
    </div>
  )
}

// ── Monte Carlo node ──────────────────────────────────────────────────────────

function MCNode({ mc }: { mc: MCResultData | null }) {
  const fmt = (v: number | null) => v == null ? '—' : (v >= 0 ? `+$${v.toFixed(0)}` : `-$${Math.abs(v).toFixed(0)}`)

  // If there's a consensus signal use it; otherwise fall back to core recommended
  const signal = mc?.consensus?.signal ?? (mc ? mc.recommended : null)
  const recColor = !signal ? 'text-cyan-400'
    : signal === 'LONG' || signal === 'STRONG_LONG' || signal === 'LEAN_LONG' ? 'text-green'
    : signal === 'SHORT' || signal === 'STRONG_SHORT' || signal === 'LEAN_SHORT' ? 'text-red'
    : 'text-yellow-400'

  const borderBg = !signal ? 'border-cyan-500/50 bg-cyan-500/8'
    : signal === 'LONG' || signal === 'STRONG_LONG' || signal === 'LEAN_LONG' ? 'border-green/50 bg-green/8'
    : signal === 'SHORT' || signal === 'STRONG_SHORT' || signal === 'LEAN_SHORT' ? 'border-red/50 bg-red/8'
    : signal === 'AVOID' ? 'border-orange/50 bg-orange/8'
    : 'border-yellow-500/50 bg-yellow-500/8'

  // Active enhancement count
  const layerCount = mc ? [mc.markov, mc.agentBased, mc.scenarios, mc.bayesian, mc.kelly].filter(Boolean).length : 0

  return (
    <div className="flex-shrink-0 w-44">
      <div className="text-xs font-bold uppercase tracking-widest text-cyan-400 mb-1 text-center">Monte Carlo</div>
      <div className={`rounded-xl border-2 ${borderBg} p-3.5 flex flex-col items-center gap-2.5 text-center shadow-lg shadow-cyan-500/10`}>
        <div className="w-9 h-9 rounded-full border-2 border-cyan-500/50 bg-cyan-500/15 flex items-center justify-center text-base">🎲</div>

        <div className="w-full space-y-0.5">
          <div className="text-xs text-muted font-medium">5,000 paths · 60-bar fwd</div>
          <div className="text-xs text-muted/70">SL = 1×ATR · TP = 1.5×ATR</div>
          {layerCount > 0 && (
            <div className="text-[10px] text-cyan-400/70 font-mono">{layerCount} enhanced layer{layerCount > 1 ? 's' : ''}</div>
          )}
        </div>

        {mc ? (
          <>
            <div className="w-full border-t border-cyan-500/20 pt-2 space-y-1.5">
              {mc.consensus && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted">Consensus</span>
                  <span className={`font-mono font-bold text-[10px] ${recColor}`}>{mc.consensus.signal.replace('_', ' ')}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted">Long win</span>
                <span className={`font-mono font-bold ${mc.long.winRate >= 50 ? 'text-green' : 'text-red'}`}>{mc.long.winRate.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted">Short win</span>
                <span className={`font-mono font-bold ${mc.short.winRate >= 50 ? 'text-green' : 'text-red'}`}>{mc.short.winRate.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted">Edge EV</span>
                <span className={`font-mono font-bold ${mc.edgeDelta >= 0 ? 'text-green' : 'text-red'}`}>{fmt(mc.edgeDelta)}</span>
              </div>
              {mc.kelly && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted">Kelly</span>
                  <span className="font-mono text-accent text-[10px]">{mc.kelly.recommendedFraction}</span>
                </div>
              )}
            </div>
            <div className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${borderBg} ${recColor}`}>
              {mc.consensus?.signal.replace('_', ' ') ?? mc.recommended}
            </div>
          </>
        ) : (
          <div className="w-full border-t border-cyan-500/20 pt-2 text-xs text-muted/70 text-center leading-relaxed">
            Runs each tick — results appear after first cycle
          </div>
        )}
      </div>
    </div>
  )
}

// ── Visual Diagram ────────────────────────────────────────────────────────────

function VisualDiagram({ agent, mc }: { agent: AgentState; mc: MCResultData | null }) {
  const { inputs, memory, decisions, actions, guardrails } = buildDiagram(agent)

  return (
    <div className="space-y-4">
      {/* Main flow */}
      <div className="flex items-start gap-1.5 overflow-x-auto pb-3">
        <DiagramColumn title="Data Inputs" color="text-blue-400" nodes={inputs} />
        <HArrow />
        <DiagramColumn title="Memory Layer" color="text-purple-400" nodes={memory} />
        <HArrow />
        <MCNode mc={mc} />
        <HArrow />
        <AgentCoreNode agent={agent} />
        <HArrow />
        <DiagramColumn title="Decisions" color="text-yellow-400" nodes={decisions} />
        <HArrow />
        <DiagramColumn title="Execution" color="text-accent" nodes={actions} />
      </div>

      {/* Guardrails bar */}
      <div className="rounded-xl border border-red/30 bg-red/5 px-5 py-4">
        <div className="text-xs font-bold uppercase tracking-widest text-red mb-3 flex items-center gap-2">
          <span>🛡️</span> Risk Guardrails — always active
        </div>
        <div className="flex flex-wrap gap-3">
          {guardrails.map(g => (
            <div key={g.id} className="flex items-center gap-2 bg-red/10 border border-red/25 rounded-lg px-3 py-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red flex-shrink-0" />
              <div>
                <span className="text-xs font-semibold text-red">{g.label}</span>
                {g.sub && <span className="text-xs text-muted ml-2">{g.sub}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1">
        {([
          { color: 'bg-blue-400',   label: 'Market Data' },
          { color: 'bg-purple-400', label: 'Memory & Context' },
          { color: 'bg-cyan-400',   label: 'Monte Carlo' },
          { color: 'bg-green',      label: 'AI Decision Engine' },
          { color: 'bg-yellow-400', label: 'Decisions' },
          { color: 'bg-accent',     label: 'Execution Actions' },
          { color: 'bg-red',        label: 'Guardrails' },
        ] as const).map(item => (
          <div key={item.label} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${item.color}`} />
            <span className="text-xs text-muted">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Analysis section card ─────────────────────────────────────────────────────

function SectionCard({ icon, title, content }: { icon: string; title: string; content: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <h3 className="text-sm font-semibold text-text">{title}</h3>
      </div>
      <p className="text-sm text-muted leading-relaxed">{content}</p>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  agent: AgentState
  agentKey: string
}

export function PromptAnalysisPanel({ agent, agentKey }: Props) {
  const [result, setResult]   = useState<AgentAnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [mc, setMC]           = useState<MCResultData | null>(null)

  // Load saved analysis + latest MC on mount
  useEffect(() => {
    setFetching(true)
    Promise.all([
      getPromptAnalysis(agentKey),
      getLatestMC(agentKey).catch(() => null),
    ]).then(([saved, mcRes]) => {
      if (saved.ok && saved.analysis && saved.meta) {
        setResult({ ok: true, analysis: saved.analysis, meta: saved.meta, createdAt: saved.createdAt })
      }
      if (mcRes?.ok && mcRes.mc) setMC(mcRes.mc)
    })
    .catch(() => {})
    .finally(() => setFetching(false))
  }, [agentKey])

  async function generate() {
    setLoading(true)
    setError(null)
    try {
      const res = await analyzeAgent(agentKey)
      setResult(res)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-[1300px] mx-auto w-full space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-text">Prompt Analysis</h2>
          <p className="text-sm text-muted mt-0.5">
            Visual breakdown of how this agent works — generated by your Platform LLM.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-green text-green rounded-lg hover:bg-green/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          {loading
            ? <><span className="w-3.5 h-3.5 border-2 border-green/40 border-t-green rounded-full animate-spin" /> Analysing…</>
            : <><span>✨</span> {result ? 'Regenerate Analysis' : 'Generate Analysis'}</>
          }
        </button>
      </div>

      {/* Loading saved */}
      {fetching && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="w-3.5 h-3.5 border-2 border-border border-t-muted rounded-full animate-spin" />
          Loading saved analysis…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red/40 bg-red/8 px-4 py-3 text-sm text-red">
          {error}
        </div>
      )}

      {/* Diagram — always visible */}
      <div className="rounded-xl border border-border bg-surface p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text">Agent Architecture</h3>
            <p className="text-xs text-muted mt-0.5">How data flows through the agent on every tick</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted border border-border rounded-md px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green" />
            {agent.config.symbol} · {agent.config.market.toUpperCase()}
          </div>
        </div>
        <VisualDiagram agent={agent} mc={mc} />
      </div>

      {/* LLM-generated analysis */}
      {result && (
        <div className="space-y-5">
          {/* Headline */}
          <div className="rounded-xl border border-green/30 bg-green/8 px-6 py-5">
            <div className="text-xs font-bold uppercase tracking-widest text-green/70 mb-2">Summary</div>
            <p className="text-base text-text leading-relaxed font-medium">{result.analysis.headline}</p>
            <div className="flex items-center gap-2 mt-3 text-xs text-muted flex-wrap">
              <span>Generated by</span>
              <span className="font-mono text-muted2">{result.meta.model}</span>
              <span>via</span>
              <span className="capitalize">{result.meta.provider}</span>
              {result.createdAt && (
                <>
                  <span className="text-border">·</span>
                  <span>{new Date(result.createdAt).toLocaleString()}</span>
                </>
              )}
            </div>
          </div>

          {/* Section grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.analysis.sections.map(s => (
              <SectionCard key={s.title} icon={s.icon} title={s.title} content={s.content} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !fetching && !error && (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 flex flex-col items-center justify-center gap-3 text-center">
          <span className="text-3xl">✨</span>
          <div>
            <p className="text-sm font-medium text-text">Generate a full agent analysis</p>
            <p className="text-xs text-muted mt-1 max-w-sm">
              The Platform LLM will read your agent's compiled prompt, strategy, and settings
              to explain in plain English how the agent will behave.
            </p>
          </div>
          <button
            onClick={generate}
            className="mt-2 px-5 py-2 text-sm font-medium border border-green text-green rounded-lg hover:bg-green/10 transition-colors"
          >
            Generate Analysis
          </button>
        </div>
      )}
    </div>
  )
}
