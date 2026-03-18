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
  decision:           'text-green',
  guardrail_block:    'text-red',
  session_skip:       'text-muted',
  auto_execute:       'text-yellow',
  auto_execute_error: 'text-red',
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
  decision:           '★ DECIDE',
  guardrail_block:    '⛔ BLOCK',
  session_skip:       '— SKIP',
  auto_execute:       '⚡ EXEC',
  auto_execute_error: '✗ EXEC',
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

// ── Main TickThread component ──────────────────────────────────────────────────

interface Props {
  thread: TickThreadData
  defaultExpanded?: boolean
}

export function TickThread({ thread, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)

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
        <div className="flex items-center gap-3 px-4 py-3">
          <span className={`text-xs font-bold font-sans shrink-0 ${statusLabelColor(thread.status)}`}>
            {statusLabel(thread.status)}
          </span>
          {tickLabel && (
            <span className="text-xs font-mono text-muted2 shrink-0">{tickLabel}</span>
          )}
          <span className="text-xs font-mono text-muted shrink-0">{agentLabel}</span>
          {thread.decision && (
            <span className={`inline-block px-2 py-0.5 rounded border text-xs font-bold font-sans shrink-0 ${decisionColor(thread.decision)}`}>
              {thread.decision}
            </span>
          )}
          {thread.reason && (
            <span className="text-xs text-muted truncate flex-1 hidden sm:block">
              "{thread.reason.slice(0, 80)}{thread.reason.length > 80 ? '...' : ''}"
            </span>
          )}
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
            <span className={`text-xs font-bold font-sans ${statusLabelColor(thread.status)}`}>
              {thread.status === 'running' ? '● LIVE' : '■'} TICK{tickLabel ? ` ${tickLabel}` : ''}
            </span>
            <span className="text-xs font-mono text-muted">{thread.agentKey}</span>
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
