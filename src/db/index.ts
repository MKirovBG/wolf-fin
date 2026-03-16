// Wolf-Fin — SQLite persistence layer

import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { AgentState, AgentStatus, CycleResult, LogEntry } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, '../../data/wolf-fin.db')

let db: Database.Database

export function initDb(): void {
  mkdirSync(join(__dirname, '../../data'), { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      key         TEXT PRIMARY KEY,
      config      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'idle',
      cycle_count INTEGER NOT NULL DEFAULT 0,
      started_at  TEXT,
      last_cycle  TEXT
    );

    CREATE TABLE IF NOT EXISTS cycle_results (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_key TEXT NOT NULL,
      symbol    TEXT NOT NULL,
      market    TEXT NOT NULL,
      paper     INTEGER NOT NULL,
      decision  TEXT NOT NULL,
      reason    TEXT NOT NULL,
      time      TEXT NOT NULL,
      error     TEXT,
      pnl_usd   REAL
    );

    CREATE TABLE IF NOT EXISTS log_entries (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      time      TEXT NOT NULL,
      agent_key TEXT NOT NULL,
      level     TEXT NOT NULL,
      event     TEXT NOT NULL,
      message   TEXT NOT NULL,
      data      TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Migration: add pnl_usd column to existing databases
  try { db.exec('ALTER TABLE cycle_results ADD COLUMN pnl_usd REAL') } catch { /* column already exists */ }
}

// ── Agents ──────────────────────────────────────────────────────────────────

export function dbGetAllAgents(): AgentState[] {
  const rows = db.prepare('SELECT * FROM agents').all() as {
    key: string
    config: string
    status: string
    cycle_count: number
    started_at: string | null
    last_cycle: string | null
  }[]
  return rows.map(row => ({
    config: JSON.parse(row.config),
    status: row.status as AgentStatus,
    cycleCount: row.cycle_count,
    startedAt: row.started_at,
    lastCycle: row.last_cycle ? JSON.parse(row.last_cycle) : null,
  }))
}

export function dbUpsertAgent(agent: AgentState): void {
  const key = `${agent.config.market}:${agent.config.symbol}`
  db.prepare(`
    INSERT INTO agents (key, config, status, cycle_count, started_at, last_cycle)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      config      = excluded.config,
      status      = excluded.status,
      cycle_count = excluded.cycle_count,
      started_at  = excluded.started_at,
      last_cycle  = excluded.last_cycle
  `).run(
    key,
    JSON.stringify(agent.config),
    agent.status,
    agent.cycleCount,
    agent.startedAt,
    agent.lastCycle ? JSON.stringify(agent.lastCycle) : null,
  )
}

export function dbRemoveAgent(key: string): void {
  db.prepare('DELETE FROM agents WHERE key = ?').run(key)
}

export function dbUpdateAgentStatus(key: string, status: AgentStatus, startedAt: string | null): void {
  db.prepare('UPDATE agents SET status = ?, started_at = ? WHERE key = ?').run(status, startedAt, key)
}

// ── Cycle results ────────────────────────────────────────────────────────────

export function dbRecordCycle(key: string, result: CycleResult): void {
  db.prepare(`
    INSERT INTO cycle_results (agent_key, symbol, market, paper, decision, reason, time, error, pnl_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    key,
    result.symbol,
    result.market,
    result.paper ? 1 : 0,
    result.decision,
    result.reason,
    result.time,
    result.error ?? null,
    result.pnlUsd ?? null,
  )
}

export function dbGetTodayRealizedPnl(market: 'crypto' | 'forex', dateStr: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(pnl_usd), 0) AS total
    FROM cycle_results
    WHERE market = ? AND date(time) = ? AND paper = 0 AND pnl_usd IS NOT NULL
  `).get(market, dateStr) as { total: number }
  return row.total
}

export interface AgentPerformanceSummary {
  totalCycles: number
  buys: number
  sells: number
  holds: number
  lastDecisions: Array<{ decision: string; reason: string; time: string }>
}

export function dbGetAgentPerformance(agentKey: string, limit = 10): AgentPerformanceSummary {
  const rows = db.prepare(
    'SELECT decision, reason, time FROM cycle_results WHERE agent_key = ? ORDER BY id DESC LIMIT ?'
  ).all(agentKey, Math.max(limit, 50)) as Array<{ decision: string; reason: string; time: string }>

  const counts = { buys: 0, sells: 0, holds: 0 }
  for (const r of rows) {
    const d = r.decision.toUpperCase()
    if (d.startsWith('BUY')) counts.buys++
    else if (d.startsWith('SELL')) counts.sells++
    else if (d.startsWith('HOLD')) counts.holds++
  }

  return {
    totalCycles: rows.length,
    ...counts,
    lastDecisions: rows.slice(0, limit).map(r => ({ decision: r.decision, reason: r.reason, time: r.time })),
  }
}

export function dbGetCycleResults(market?: string, limit = 500): CycleResult[] {
  const rows = market
    ? db.prepare('SELECT * FROM cycle_results WHERE market = ? ORDER BY id DESC LIMIT ?').all(market, limit)
    : db.prepare('SELECT * FROM cycle_results ORDER BY id DESC LIMIT ?').all(limit)
  return (rows as {
    symbol: string; market: string; paper: number
    decision: string; reason: string; time: string; error: string | null
  }[]).map(r => ({
    symbol: r.symbol,
    market: r.market as 'crypto' | 'forex',
    paper: r.paper === 1,
    decision: r.decision,
    reason: r.reason,
    time: r.time,
    ...(r.error ? { error: r.error } : {}),
  }))
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function dbGetLogClearFloor(): number {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('log_clear_floor') as { value: string } | undefined
  return row ? parseInt(row.value, 10) : 0
}

export function dbSetLogClearFloor(id: number): void {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('log_clear_floor', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(id))
}

// ── Log entries ──────────────────────────────────────────────────────────────

export function dbGetMaxLogId(): number {
  const row = db.prepare('SELECT MAX(id) as maxId FROM log_entries').get() as { maxId: number | null }
  return row?.maxId ?? 0
}

export function dbLogEvent(entry: LogEntry): void {
  db.prepare(`
    INSERT INTO log_entries (id, time, agent_key, level, event, message, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.time,
    entry.agentKey,
    entry.level,
    entry.event,
    entry.message,
    entry.data ? JSON.stringify(entry.data) : null,
  )
}

export function dbGetLogs(sinceId?: number, agentKey?: string, limit = 200): LogEntry[] {
  let sql: string
  let params: unknown[]

  if (sinceId && agentKey) {
    sql = 'SELECT * FROM log_entries WHERE id > ? AND agent_key = ? ORDER BY id DESC LIMIT ?'
    params = [sinceId, agentKey, limit]
  } else if (sinceId) {
    sql = 'SELECT * FROM log_entries WHERE id > ? ORDER BY id DESC LIMIT ?'
    params = [sinceId, limit]
  } else if (agentKey) {
    sql = 'SELECT * FROM log_entries WHERE agent_key = ? ORDER BY id DESC LIMIT ?'
    params = [agentKey, limit]
  } else {
    sql = 'SELECT * FROM log_entries ORDER BY id DESC LIMIT ?'
    params = [limit]
  }

  const rows = db.prepare(sql).all(...params) as {
    id: number; time: string; agent_key: string
    level: string; event: string; message: string; data: string | null
  }[]

  return rows.map(r => ({
    id: r.id,
    time: r.time,
    agentKey: r.agent_key,
    level: r.level as LogEntry['level'],
    event: r.event as LogEntry['event'],
    message: r.message,
    ...(r.data ? { data: JSON.parse(r.data) } : {}),
  }))
}
