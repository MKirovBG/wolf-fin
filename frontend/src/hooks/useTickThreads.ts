import { useMemo } from 'react'
import type { LogEntry, LogEvent } from '../types/index.ts'

export interface TickThread {
  id: string
  agentKey: string
  startTime: string
  endTime?: string
  status: 'running' | 'complete' | 'error' | 'skipped' | 'session_event'
  tickNumber: number
  iterationCount: number
  decision?: string
  reason?: string
  logs: LogEntry[]
  thinkingLogs: LogEntry[]
  toolLogs: LogEntry[]
  decisionLogs: LogEntry[]
  errorLogs: LogEntry[]
  mcLogs: LogEntry[]   // Monte Carlo result entries
}

function parseDecisionLog(message: string): { decision?: string; reason?: string } {
  const body = message.replace(/^DECISION:\s*/i, '').trim()
  if (!body) return {}
  const decision = body.match(/^([A-Z_]+)/)?.[1]
  const reason   = body.match(/[—–]\s*(.+)$/s)?.[1]?.trim()
  return { decision, reason }
}

function extractTickNumber(message: string): number {
  return parseInt(message.match(/Tick\s*#(\d+)/i)?.[1] ?? '0', 10)
}

function countToolIterations(logs: LogEntry[]): number {
  return logs.filter(l => l.event === 'tool_call').length
}

// Events that open a new tick thread
const TICK_START_EVENTS = new Set<LogEvent>(['tick_start', 'cycle_start'])
// Events that close the current tick thread
const TICK_END_EVENTS   = new Set<LogEvent>(['tick_end', 'tick_error', 'cycle_end', 'cycle_error'])
// Events that become standalone "skip" pills
const SKIP_EVENTS       = new Set<LogEvent>(['tick_skip', 'cycle_skip', 'session_skip'])
// Events that become standalone "session" info pills
const SESSION_EVENTS    = new Set<LogEvent>(['session_start', 'session_reset'])

export function useTickThreads(logs: LogEntry[], agentKey?: string, agentKeys?: Set<string>): TickThread[] {
  return useMemo(() => {
    // Work oldest-first for grouping (server returns newest-first)
    const sorted = [...logs].sort((a, b) => a.id - b.id)

    const threads: TickThread[] = []
    let current: LogEntry[] | null = null
    let startLog: LogEntry | null  = null

    for (const entry of sorted) {
      if (agentKey && entry.agentKey !== agentKey) continue
      if (agentKeys && !agentKeys.has(entry.agentKey)) continue

      if (TICK_START_EVENTS.has(entry.event)) {
        current  = [entry]
        startLog = entry

      } else if (SKIP_EVENTS.has(entry.event)) {
        threads.push({
          id: `thread-skip-${entry.id}`,
          agentKey: entry.agentKey,
          startTime: entry.time,
          endTime: entry.time,
          status: 'skipped',
          tickNumber: 0,
          iterationCount: 0,
          logs: [entry],
          thinkingLogs: [], toolLogs: [], decisionLogs: [], errorLogs: [], mcLogs: [],
        })

      } else if (SESSION_EVENTS.has(entry.event)) {
        threads.push({
          id: `thread-session-${entry.id}`,
          agentKey: entry.agentKey,
          startTime: entry.time,
          endTime: entry.time,
          status: 'session_event',
          tickNumber: 0,
          iterationCount: 0,
          logs: [entry],
          thinkingLogs: [], toolLogs: [], decisionLogs: [], errorLogs: [], mcLogs: [],
        })

      } else if (current !== null) {
        current.push(entry)

        if (TICK_END_EVENTS.has(entry.event)) {
          const threadLogs     = current
          const thinkingLogs   = threadLogs.filter(l => l.event === 'claude_thinking')
          const toolLogs       = threadLogs.filter(l => l.event === 'tool_call' || l.event === 'tool_result')
          const decisionLogs   = threadLogs.filter(l =>
            l.event === 'decision' || l.event === 'auto_execute' || l.event === 'auto_execute_error'
          )
          const errorLogs      = threadLogs.filter(l =>
            l.level === 'error' || l.event === 'tool_error' || TICK_END_EVENTS.has(l.event as LogEvent) && l.event.includes('error') || l.event === 'guardrail_block'
          )
          const mcLogs         = threadLogs.filter(l => l.event === 'mc_result')
          const decisionEntry  = threadLogs.find(l => l.event === 'decision')
          const parsed         = decisionEntry ? parseDecisionLog(decisionEntry.message) : {}
          const isError        = entry.event === 'tick_error' || entry.event === 'cycle_error'

          threads.push({
            id: `thread-${startLog!.id}`,
            agentKey: startLog!.agentKey,
            startTime: startLog!.time,
            endTime: entry.time,
            status: isError ? 'error' : 'complete',
            tickNumber: extractTickNumber(startLog!.message),
            iterationCount: countToolIterations(threadLogs),
            decision: parsed.decision,
            reason: parsed.reason,
            logs: threadLogs,
            thinkingLogs, toolLogs, decisionLogs, errorLogs, mcLogs,
          })
          current  = null
          startLog = null
        }
      }
    }

    // Open (running) tick
    if (current !== null && startLog !== null) {
      const thinkingLogs = current.filter(l => l.event === 'claude_thinking')
      const toolLogs     = current.filter(l => l.event === 'tool_call' || l.event === 'tool_result')
      const decisionLogs = current.filter(l =>
        l.event === 'decision' || l.event === 'auto_execute' || l.event === 'auto_execute_error'
      )
      const errorLogs    = current.filter(l => l.level === 'error' || l.event === 'tool_error' || l.event === 'guardrail_block')
      const mcLogs       = current.filter(l => l.event === 'mc_result')
      const decisionEntry = current.find(l => l.event === 'decision')
      const parsed        = decisionEntry ? parseDecisionLog(decisionEntry.message) : {}

      threads.push({
        id: `thread-${startLog.id}`,
        agentKey: startLog.agentKey,
        startTime: startLog.time,
        status: 'running',
        tickNumber: extractTickNumber(startLog.message),
        iterationCount: countToolIterations(current),
        decision: parsed.decision,
        reason: parsed.reason,
        logs: current,
        thinkingLogs, toolLogs, decisionLogs, errorLogs, mcLogs,
      })
    }

    return threads.reverse()
  }, [logs, agentKey, agentKeys])
}
