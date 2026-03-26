import { useState } from 'react'
import type { TickThread as TickThreadData } from '../hooks/useTickThreads.ts'
import type { LogEntry, LogEvent } from '../types/index.ts'

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  return `${Math.floor(d / 3600000)}h ago`
}

// ── Symbol colours — consistent per symbol across the UI ──────────────────────

const SYMBOL_PALETTE = [
  'text-green',    // #0
  'text-blue',     // #1
  'text-yellow',   // #2
  'text-[#e879f9]', // fuchsia  #3
  'text-[#38bdf8]', // sky      #4
  'text-[#fb923c]', // orange   #5
  'text-[#a78bfa]', // violet   #6
  'text-[#34d399]', // emerald  #7
]

const symbolColorCache = new Map<string, string>()

function symbolColor(sym: string): string {
  if (!symbolColorCache.has(sym)) {
    // Deterministic hash so same symbol always gets same colour
    let h = 0
    for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) >>> 0
    symbolColorCache.set(sym, SYMBOL_PALETTE[h % SYMBOL_PALETTE.length]!)
  }
  return symbolColorCache.get(sym)!
}

// ── Decision badge colors ──────────────────────────────────────────────────────

function decisionColor(decision?: string): string {
  if (!decision) return 'text-muted bg-surface3 border-border'
  const u = decision.toUpperCase()
  if (u.startsWith('BUY'))   return 'text-green bg-green-dim border-green/30'
  if (u.startsWith('SELL'))  return 'text-red bg-red-dim border-red/30'
  if (u.startsWith('HOLD'))  return 'text-muted bg-surface3 border-border'
  if (u.startsWith('CLOSE')) return 'text-yellow bg-yellow-dim border-yellow/30'
  if (u.startsWith('CANCEL')) return 'text-muted bg-surface3 border-border'
  if (u.startsWith('EMERGENCY') || u.startsWith('ERROR')) return 'text-red bg-red-dim border-red/30'
  if (u.startsWith('EXTERNAL_CLOSE')) return 'text-yellow bg-yellow-dim border-yellow/30'
  return 'text-muted bg-surface3 border-border'
}

// ── Status helpers ─────────────────────────────────────────────────────────────

function statusBorderClass(status: TickThreadData['status']): string {
  if (status === 'running')  return 'border-l-2 border-l-green animate-pulse'
  if (status === 'complete') return 'border-l-2 border-l-green'
  if (status === 'error')    return 'border-l-2 border-l-red'
  if (status === 'skipped')  return 'border-l-2 border-l-muted2'
  return ''
}

function statusLabel(status: TickThreadData['status']): string {
  if (status === 'running')  return 'LIVE'
  if (status === 'complete') return 'DONE'
  if (status === 'error')    return 'ERROR'
  if (status === 'skipped')  return 'SKIP'
  return String(status).toUpperCase()
}

function statusLabelColor(status: TickThreadData['status']): string {
  if (status === 'running')  return 'text-green'
  if (status === 'complete') return 'text-green'
  if (status === 'error')    return 'text-red'
  return 'text-muted'
}

// ── Log entry colors ───────────────────────────────────────────────────────────

const EVENT_COLOR: Partial<Record<LogEvent, string>> & { default: string } = {
  tick_start:         'text-green',
  tick_end:           'text-green',
  tick_error:         'text-red',
  tick_skip:          'text-muted',
  session_start:      'text-green',
  session_reset:      'text-yellow',
  cycle_start:        'text-green',
  cycle_end:          'text-green',
  cycle_error:        'text-red',
  cycle_skip:         'text-muted',
  tool_call:          'text-blue',
  tool_result:        'text-blue',
  tool_error:         'text-red',
  claude_thinking:    'text-muted',
  llm_request:        'text-muted',
  decision:           'text-green',
  guardrail_block:    'text-red',
  session_skip:       'text-muted',
  auto_execute:       'text-yellow',
  auto_execute_error: 'text-red',
  mc_result:          'text-[#a78bfa]',
  ml_signal:          'text-[#a78bfa]',
  default:            'text-text',
}

const EVENT_PREFIX: Partial<Record<LogEvent, string>> & { default: string } = {
  tick_start:         '▶ TICK',
  tick_end:           '■ DONE',
  tick_error:         '✗ ERROR',
  tick_skip:          '— SKIP',
  session_start:      '◎ SESSION',
  session_reset:      '↺ RESET',
  cycle_start:        '▶ CYCLE',
  cycle_end:          '■ DONE',
  cycle_error:        '✗ ERROR',
  cycle_skip:         '— SKIP',
  tool_call:          '→ CALL',
  tool_result:        '← RESULT',
  tool_error:         '✗ TOOL',
  claude_thinking:    '💭 THINK',
  llm_request:        '📡 LLM',
  decision:           '★ DECIDE',
  guardrail_block:    '⛔ BLOCK',
  session_skip:       '— SKIP',
  auto_execute:       '⚡ EXEC',
  auto_execute_error: '✗ EXEC',
  mc_result:          '🎲 MC',
  ml_signal:          '🤖 ML',
  default:            '·',
}

// ── Single log line ────────────────────────────────────────────────────────────

function LogLine({ entry }: { entry: LogEntry }) {
  const color  = EVENT_COLOR[entry.event] ?? EVENT_COLOR.default
  const prefix = EVENT_PREFIX[entry.event] ?? entry.event
  const isMultiLine = entry.message.includes('\n')

  return (
    <div className={`flex gap-2 items-start py-1.5 px-3 border-b border-border/50 hover:bg-surface2 transition-colors ${entry.level === 'error' ? 'bg-red-dim/30' : ''}`}>
      <span className="text-muted2 text-xs font-mono whitespace-nowrap mt-0.5 shrink-0">{timeStr(entry.time)}</span>
      <span className={`text-xs font-bold font-mono whitespace-nowrap mt-0.5 w-16 shrink-0 ${color}`}>{prefix}</span>
      <div className={`text-xs font-mono leading-relaxed flex-1 min-w-0 ${color}`}>
        {isMultiLine
          ? <pre className="whitespace-pre-wrap break-words text-xs font-mono leading-relaxed">{entry.message}</pre>
          : <span className="break-words">{entry.message}</span>
        }
      </div>
    </div>
  )
}

// ── Tool call/result pair view ─────────────────────────────────────────────────

function ToolPairs({ logs }: { logs: LogEntry[] }) {
  const calls = logs.filter(l => l.event === 'tool_call' || l.event === 'tool_result')

  return (
    <div className="space-y-2 p-3">
      {calls.length === 0 && <p className="text-xs text-muted text-center py-2">No tool calls</p>}
      {calls.map(entry => (
        <div key={entry.id} className={`rounded border ${entry.event === 'tool_call' ? 'border-blue/20 bg-blue-dim/30' : 'border-border bg-surface2'}`}>
          <div className={`text-xs font-bold px-3 py-1.5 border-b ${entry.event === 'tool_call' ? 'border-blue/20 text-blue' : 'border-border text-muted'} font-sans`}>
            {entry.event === 'tool_call' ? 'Call' : 'Result'} · {timeStr(entry.time)}
          </div>
          <pre className="text-xs font-mono leading-relaxed p-3 whitespace-pre-wrap break-words max-h-48 overflow-auto text-text">
            {entry.message}
          </pre>
        </div>
      ))}
    </div>
  )
}

// ── Expandable section ─────────────────────────────────────────────────────────

function Section({
  title, count, children, defaultOpen = false, color = 'text-muted',
}: {
  title: string
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
  color?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const empty = count === 0

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => !empty && setOpen(v => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${empty ? 'cursor-default opacity-40' : 'hover:bg-surface2'}`}
        disabled={empty}
      >
        <span className={`text-xs font-semibold ${color} font-sans`}>{open ? '▼' : '▶'} {title}</span>
        <span className={`text-xs font-mono ml-auto ${empty ? 'text-muted2' : color}`}>({count})</span>
      </button>
      {open && !empty && (
        <div className="bg-bg border-t border-border">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Monte Carlo result table ───────────────────────────────────────────────────

interface MCActionResult {
  winRate: number; ev: number; p10: number; p50: number; p90: number
  slHitPct: number; medianBarsToClose: number
}
interface MCData {
  long: MCActionResult; short: MCActionResult
  recommended: 'LONG' | 'SHORT' | 'HOLD'
  edgeDelta: number; pathCount: number; barsForward: number
}

function fmt$(v: number) { return `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(0)}` }
function pct(v: number)  { return `${v.toFixed(1)}%` }

function MCTable({ entry }: { entry: LogEntry }) {
  const mc = entry.data as unknown as MCData | undefined
  if (!mc?.long || !mc?.short) {
    // Fallback: just show the message as monospace
    return (
      <pre className="text-xs font-mono text-[#a78bfa] whitespace-pre-wrap break-words p-3 leading-relaxed">
        {entry.message}
      </pre>
    )
  }

  const recColor = mc.recommended === 'LONG'  ? 'text-green'
                 : mc.recommended === 'SHORT' ? 'text-red'
                 : 'text-muted'

  const rows: Array<{ label: string; r: MCActionResult; isRec: boolean }> = [
    { label: 'LONG',  r: mc.long,  isRec: mc.recommended === 'LONG'  },
    { label: 'SHORT', r: mc.short, isRec: mc.recommended === 'SHORT' },
  ]

  return (
    <div className="p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-[#a78bfa] font-sans uppercase tracking-wider">Monte Carlo</span>
        <span className="text-[10px] text-muted2 font-mono">{mc.pathCount.toLocaleString()} paths · M1 · {mc.barsForward}-bar fwd</span>
        <span className={`ml-auto text-xs font-bold font-sans ${recColor}`}>
          {mc.recommended === 'HOLD' ? '⚠ HOLD — negative EV both sides' : `▶ ${mc.recommended} recommended`}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface2">
              <th className="text-left px-3 py-1.5 text-muted font-semibold">Action</th>
              <th className="text-right px-2 py-1.5 text-muted font-semibold">Win %</th>
              <th className="text-right px-2 py-1.5 text-muted font-semibold">EV</th>
              <th className="text-right px-2 py-1.5 text-muted font-semibold">P10</th>
              <th className="text-right px-2 py-1.5 text-muted font-semibold">P50</th>
              <th className="text-right px-2 py-1.5 text-muted font-semibold">P90</th>
              <th className="text-right px-2 py-1.5 text-muted font-semibold">SL hit</th>
              <th className="text-right px-2 py-1.5 text-muted font-semibold">Med.bars</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, r, isRec }) => (
              <tr key={label} className={`border-b border-border/50 ${isRec ? 'bg-surface2' : ''}`}>
                <td className={`px-3 py-1.5 font-bold ${label === 'LONG' ? 'text-green' : 'text-red'}`}>
                  {label}{isRec ? ' ◀' : ''}
                </td>
                <td className="text-right px-2 py-1.5 text-text">{pct(r.winRate)}</td>
                <td className={`text-right px-2 py-1.5 font-bold ${r.ev >= 0 ? 'text-green' : 'text-red'}`}>{fmt$(r.ev)}</td>
                <td className="text-right px-2 py-1.5 text-red">{fmt$(r.p10)}</td>
                <td className="text-right px-2 py-1.5 text-text">{fmt$(r.p50)}</td>
                <td className="text-right px-2 py-1.5 text-green">{fmt$(r.p90)}</td>
                <td className="text-right px-2 py-1.5 text-muted">{pct(r.slHitPct)}</td>
                <td className="text-right px-2 py-1.5 text-muted">{r.medianBarsToClose.toFixed(0)}m</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edge delta */}
      <p className="text-[10px] text-muted2 font-mono">
        Edge delta vs HOLD: {fmt$(mc.edgeDelta)}
      </p>
    </div>
  )
}

// ── Main TickThread component ──────────────────────────────────────────────────

interface Props {
  thread: TickThreadData
  defaultExpanded?: boolean
}

export function TickThread({ thread, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const parts      = thread.agentKey.split(':')       // ['mt5', 'XAUUSD', '1512...', 'gold']
  const market     = parts[0] ?? ''                   // 'mt5'
  const symbol     = parts[1] ?? thread.agentKey      // 'XAUUSD'
  const agentName  = parts[3] ?? ''                   // 'gold' (optional)
  const agentLabel = thread.agentKey.split(':').slice(0, 2).join(':')
  const tickLabel  = thread.tickNumber > 0 ? `#${thread.tickNumber}` : ''

  // ── Session event — informational pill ──────────────────────────────────────
  if (thread.status === 'session_event') {
    const entry = thread.logs[0]
    const isReset = entry?.event === 'session_reset'
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 border rounded-md ${isReset ? 'bg-yellow-dim/20 border-yellow/20' : 'bg-green-dim/10 border-green/20'}`}>
        <span className={`text-xs font-bold font-sans shrink-0 ${isReset ? 'text-yellow' : 'text-green'}`}>
          {isReset ? '↺ NEW DAY' : '◎ SESSION'}
        </span>
        <span className="text-xs font-mono text-muted2 shrink-0">{agentLabel}</span>
        <span className="text-xs text-muted2 truncate flex-1">{entry?.message ?? ''}</span>
        <span className="text-xs text-muted2 shrink-0">{rel(thread.startTime)}</span>
      </div>
    )
  }

  // ── Skipped — compact pill ──────────────────────────────────────────────────
  if (thread.status === 'skipped') {
    const msg = thread.logs[0]?.message ?? 'Skipped'
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-border/50 rounded-md opacity-60 hover:opacity-80 transition-opacity">
        <span className="text-xs font-bold text-muted font-sans shrink-0">— SKIP</span>
        <span className="text-xs font-mono text-muted2 shrink-0">{agentLabel}</span>
        <span className="text-xs text-muted2 truncate flex-1">{msg}</span>
        <span className="text-xs text-muted2 shrink-0">{rel(thread.startTime)}</span>
      </div>
    )
  }

  // ── Collapsed row ───────────────────────────────────────────────────────────
  if (!expanded) {
    return (
      <div
        className={`bg-surface border border-border rounded-lg cursor-pointer hover:border-muted2 transition-all ${statusBorderClass(thread.status)}`}
        onClick={() => setExpanded(true)}
      >
        <div className="flex items-center gap-3 px-4 py-2.5">
          {/* Symbol — most important, always visible */}
          <span className={`text-sm font-bold tracking-wide font-mono shrink-0 ${symbolColor(symbol)}`}>{symbol}</span>
          {agentName && (
            <span className="text-[10px] text-muted2 font-mono shrink-0">({agentName})</span>
          )}
          <span className="text-[10px] uppercase tracking-wider text-muted2 border border-border/60 rounded px-1 py-0.5 shrink-0">{market}</span>
          {tickLabel && (
            <span className="text-xs font-mono text-muted2 shrink-0">{tickLabel}</span>
          )}
          {thread.decision && (
            <span className={`inline-block px-2 py-0.5 rounded border text-xs font-bold font-sans shrink-0 ${decisionColor(thread.decision)}`}>
              {thread.decision}
            </span>
          )}
          {thread.reason && (
            <span className="text-xs text-muted truncate flex-1 hidden sm:block">
              {thread.reason.slice(0, 90)}{thread.reason.length > 90 ? '…' : ''}
            </span>
          )}
          {thread.mcLogs.length > 0 && (() => {
            const mc = thread.mcLogs[0]?.data as unknown as { recommended?: string; long?: { ev?: number }; short?: { ev?: number } } | undefined
            const rec = mc?.recommended
            const evColor = rec === 'LONG' ? 'text-green' : rec === 'SHORT' ? 'text-red' : 'text-muted'
            return (
              <span className={`text-[10px] font-mono shrink-0 hidden sm:inline ${evColor}`}>
                🎲 {rec ?? 'MC'}
              </span>
            )
          })()}
          <span className="text-xs text-muted2 shrink-0 ml-auto">{rel(thread.startTime)}</span>
          <span className="text-muted2 text-xs shrink-0">▼</span>
        </div>
      </div>
    )
  }

  // ── Expanded view ───────────────────────────────────────────────────────────
  return (
    <div className={`bg-surface border border-border rounded-lg overflow-hidden ${statusBorderClass(thread.status)}`}>
      {/* Header */}
      <div
        className="flex items-start justify-between px-4 py-3 bg-surface2 border-b border-border cursor-pointer hover:bg-surface3 transition-colors"
        onClick={() => setExpanded(false)}
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-bold tracking-wide font-mono ${symbolColor(symbol)}`}>{symbol}</span>
            {agentName && <span className="text-[10px] text-muted2 font-mono">({agentName})</span>}
            <span className="text-[10px] uppercase tracking-wider text-muted2 border border-border/60 rounded px-1 py-0.5">{market}</span>
            {tickLabel && <span className="text-xs font-mono text-muted2">{tickLabel}</span>}
            <span className="text-xs text-muted2 font-mono">
              {timeStr(thread.startTime)}{thread.endTime ? ` → ${timeStr(thread.endTime)}` : ' → running...'}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted font-sans">Status:</span>
            <span className={`text-xs font-semibold font-sans ${statusLabelColor(thread.status)}`}>{thread.status.toUpperCase()}</span>
            {thread.decision && (
              <>
                <span className="text-muted2">·</span>
                <span className="text-xs text-muted">Decision:</span>
                <span className={`inline-block px-2 py-0.5 rounded border text-xs font-bold font-sans ${decisionColor(thread.decision)}`}>
                  {thread.decision}
                </span>
              </>
            )}
            <span className="text-muted2">·</span>
            <span className="text-xs text-muted font-sans">Tool calls: <span className="text-text">{thread.iterationCount}</span></span>
          </div>
          {thread.reason && (
            <p className="text-xs text-muted leading-relaxed max-w-2xl">{thread.reason}</p>
          )}
        </div>
        <span className="text-muted2 text-xs shrink-0 ml-4 mt-0.5">▲</span>
      </div>

      {/* Sections */}
      <div className="overflow-y-auto" style={{ maxHeight: '560px', scrollbarWidth: 'thin', scrollbarColor: '#2a2a32 #111113' }}>
        <Section
          title="Monte Carlo"
          count={thread.mcLogs.length}
          defaultOpen={thread.mcLogs.length > 0}
          color="text-[#a78bfa]"
        >
          {thread.mcLogs.map(e => <MCTable key={e.id} entry={e} />)}
        </Section>

        <Section
          title="Decision & Reason"
          count={thread.decisionLogs.length}
          defaultOpen={thread.decisionLogs.length > 0}
          color="text-green"
        >
          {thread.decisionLogs.map(e => <LogLine key={e.id} entry={e} />)}
        </Section>

        <Section
          title="Thinking"
          count={thread.thinkingLogs.length}
          defaultOpen={false}
          color="text-yellow"
        >
          {thread.thinkingLogs.map(e => <LogLine key={e.id} entry={e} />)}
        </Section>

        <Section
          title="Tool Calls"
          count={thread.toolLogs.length}
          defaultOpen={false}
          color="text-blue"
        >
          <ToolPairs logs={thread.toolLogs} />
        </Section>

        <Section
          title="Errors"
          count={thread.errorLogs.length}
          defaultOpen={thread.errorLogs.length > 0}
          color="text-red"
        >
          {thread.errorLogs.map(e => <LogLine key={e.id} entry={e} />)}
        </Section>
      </div>
    </div>
  )
}
