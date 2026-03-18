import { useMemo } from 'react'
import type { LogEntry, LogEvent } from '../types/index.ts'

export interface CycleThread {
  id: string
  agentKey: string
  startTime: string
  endTime?: string
  status: 'running' | 'complete' | 'error' | 'skipped'
  iterationCount: number
  decision?: string
  reason?: string
  logs: LogEntry[]
  thinkingLogs: LogEntry[]
  toolLogs: LogEntry[]
  decisionLogs: LogEntry[]
  errorLogs: LogEntry[]
}

function parseDecisionLog(message: string): { decision?: string; reason?: string } {
  // Message format: "DECISION: BUY 0.01 @ 5002.73 — reason" or "DECISION: HOLD — reason"
  // Strip leading "DECISION: " prefix produced by the agent logger
  const body = message.replace(/^DECISION:\s*/i, '').trim()
  if (!body) return {}
  // First UPPERCASE word is the action (BUY / SELL / HOLD / CLOSE / CANCEL / ERROR / EMERGENCY_STOP …)
  const decision = body.match(/^([A-Z_]+)/)?.[1]
  // Reason is everything after the — / – separator
  const reason = body.match(/[—–]\s*(.+)$/s)?.[1]?.trim()
  return { decision, reason }
}

function countToolIterations(logs: LogEntry[]): number {
  return logs.filter(l => l.event === 'tool_call').length
}

export function useCycleThreads(logs: LogEntry[], agentKey?: string): CycleThread[] {
  return useMemo(() => {
    // Work with oldest-first for grouping (logs from server are newest-first)
    const sorted = [...logs].sort((a, b) => a.id - b.id)

    const threads: CycleThread[] = []
    let current: LogEntry[] | null = null
    let startLog: LogEntry | null = null

    for (const entry of sorted) {
      // Filter by agentKey if provided
      if (agentKey && entry.agentKey !== agentKey) continue

      if (entry.event === 'cycle_start') {
        // Start a new thread
        current = [entry]
        startLog = entry
      } else if (entry.event === 'cycle_skip' || entry.event === 'session_skip') {
        // Standalone skip event — no cycle thread
        threads.push({
          id: `thread-skip-${entry.id}`,
          agentKey: entry.agentKey,
          startTime: entry.time,
          endTime: entry.time,
          status: 'skipped',
          iterationCount: 0,
          logs: [entry],
          thinkingLogs: [],
          toolLogs: [],
          decisionLogs: [],
          errorLogs: [],
        })
      } else if (current !== null) {
        current.push(entry)

        if (entry.event === 'cycle_end' || entry.event === 'cycle_error') {
          // Close current thread
          const threadLogs = current
          const thinkingLogs = threadLogs.filter(l => l.event === 'claude_thinking')
          const toolLogs = threadLogs.filter(l =>
            l.event === 'tool_call' || l.event === 'tool_result'
          )
          const decisionLogs = threadLogs.filter(l =>
            l.event === 'decision' || l.event === 'auto_execute' || l.event === 'auto_execute_error'
          )
          const errorLogs = threadLogs.filter(l =>
            l.level === 'error' || l.event === 'tool_error' || l.event === 'cycle_error' || l.event === 'guardrail_block'
          )

          const decisionEntry = threadLogs.find(l => l.event === 'decision')
          const parsed = decisionEntry ? parseDecisionLog(decisionEntry.message) : {}

          threads.push({
            id: `thread-${startLog!.id}`,
            agentKey: startLog!.agentKey,
            startTime: startLog!.time,
            endTime: entry.time,
            status: entry.event === 'cycle_error' ? 'error' : 'complete',
            iterationCount: countToolIterations(threadLogs),
            decision: parsed.decision,
            reason: parsed.reason,
            logs: threadLogs,
            thinkingLogs,
            toolLogs,
            decisionLogs,
            errorLogs,
          })
          current = null
          startLog = null
        }
      }
    }

    // If there's an open (running) cycle, include it
    if (current !== null && startLog !== null) {
      const thinkingLogs = current.filter(l => l.event === 'claude_thinking')
      const toolLogs = current.filter(l => l.event === 'tool_call' || l.event === 'tool_result')
      const decisionLogs = current.filter(l =>
        l.event === 'decision' || l.event === 'auto_execute' || l.event === 'auto_execute_error'
      )
      const errorLogs = current.filter(l =>
        l.level === 'error' || l.event === 'tool_error' || l.event === 'guardrail_block'
      )
      const decisionEntry = current.find(l => l.event === 'decision')
      const parsed = decisionEntry ? parseDecisionLog(decisionEntry.message) : {}

      threads.push({
        id: `thread-${startLog.id}`,
        agentKey: startLog.agentKey,
        startTime: startLog.time,
        status: 'running',
        iterationCount: countToolIterations(current),
        decision: parsed.decision,
        reason: parsed.reason,
        logs: current,
        thinkingLogs,
        toolLogs,
        decisionLogs,
        errorLogs,
      })
    }

    // Return newest-first
    return threads.reverse()
  }, [logs, agentKey])
}
