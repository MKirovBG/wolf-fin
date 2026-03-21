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

  // ── New tables ────────────────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_key TEXT NOT NULL,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.7,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT,
      UNIQUE(agent_key, category, key) ON CONFLICT REPLACE
    );

    CREATE TABLE IF NOT EXISTS agent_strategies (
      agent_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      style TEXT NOT NULL,
      bias TEXT,
      timeframe TEXT,
      entry_rules TEXT NOT NULL,
      exit_rules TEXT NOT NULL,
      filters TEXT,
      max_positions INTEGER DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_key TEXT NOT NULL,
      session_date TEXT NOT NULL,
      session_label TEXT,
      market_bias TEXT NOT NULL,
      key_levels TEXT,
      risk_notes TEXT,
      plan_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      cycle_count_at INTEGER,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS agent_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_key TEXT NOT NULL,
      analysis_type TEXT NOT NULL,
      cycles_reviewed INTEGER,
      win_rate REAL,
      avg_pnl_usd REAL,
      summary_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT
    );
  `)

  // Migration: add pnl_usd column to existing databases
  try { db.exec('ALTER TABLE cycle_results ADD COLUMN pnl_usd REAL') } catch { /* column already exists */ }

  // Migration: add prompt_template and guardrails columns to agents table
  try { db.exec('ALTER TABLE agents ADD COLUMN prompt_template TEXT') } catch { /* column already exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN guardrails TEXT') } catch { /* column already exists */ }
  // Keep max_loss_usd for backward compat — new agents won't use it
  try { db.exec('ALTER TABLE agents ADD COLUMN max_loss_usd REAL DEFAULT 0') } catch { /* column already exists */ }

  // Agent sessions table (session-based tick architecture)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        agent_key    TEXT NOT NULL,
        session_date TEXT NOT NULL,
        tick_count   INTEGER NOT NULL DEFAULT 0,
        messages     TEXT NOT NULL DEFAULT '[]',
        summary      TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        PRIMARY KEY (agent_key, session_date)
      )
    `)
  } catch { /* already exists */ }
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

export function makeAgentKey(market: string, symbol: string, mt5AccountId?: number, name?: string): string {
  const namePart = name ? `:${name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}` : ''
  if (market === 'mt5' && mt5AccountId) return `mt5:${symbol}:${mt5AccountId}${namePart}`
  return `${market}:${symbol}${namePart}`
}

export function dbUpsertAgent(agent: AgentState): void {
  const key = makeAgentKey(agent.config.market, agent.config.symbol, agent.config.mt5AccountId, agent.config.name)
  db.prepare(`
    INSERT INTO agents (key, config, status, cycle_count, started_at, last_cycle, prompt_template, guardrails)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      config          = excluded.config,
      status          = excluded.status,
      cycle_count     = excluded.cycle_count,
      started_at      = excluded.started_at,
      last_cycle      = excluded.last_cycle,
      prompt_template = excluded.prompt_template,
      guardrails      = excluded.guardrails
  `).run(
    key,
    JSON.stringify(agent.config),
    agent.status,
    agent.cycleCount,
    agent.startedAt,
    agent.lastCycle ? JSON.stringify(agent.lastCycle) : null,
    agent.config.promptTemplate ?? null,
    agent.config.guardrails ? JSON.stringify(agent.config.guardrails) : null,
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

export function dbGetTodayRealizedPnl(market: 'crypto' | 'forex' | 'mt5', dateStr: string): number {
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

export interface AgentStats {
  totalTicks: number
  totalTrades: number
  wins: number
  losses: number
  winRate: number | null        // 0–1
  avgWin: number | null         // USD
  avgLoss: number | null        // USD (positive)
  riskReward: number | null     // avgWin / avgLoss
  sharpe: number | null         // annualised Sharpe on daily P&L
  totalPnl: number
  equityCurve: Array<{ time: string; cumPnl: number }>
}

export function dbGetAgentStats(agentKey: string, limit = 1000): AgentStats {
  const rows = db.prepare(
    'SELECT time, pnl_usd FROM cycle_results WHERE agent_key = ? AND pnl_usd IS NOT NULL ORDER BY id ASC LIMIT ?'
  ).all(agentKey, limit) as Array<{ time: string; pnl_usd: number }>

  const totalRows = db.prepare(
    'SELECT COUNT(*) as n FROM cycle_results WHERE agent_key = ?'
  ).get(agentKey) as { n: number }

  const wins   = rows.filter(r => r.pnl_usd > 0)
  const losses = rows.filter(r => r.pnl_usd < 0)

  const winRate    = rows.length > 0 ? wins.length / rows.length : null
  const avgWin     = wins.length > 0   ? wins.reduce((s, r) => s + r.pnl_usd, 0) / wins.length : null
  const avgLoss    = losses.length > 0 ? Math.abs(losses.reduce((s, r) => s + r.pnl_usd, 0) / losses.length) : null
  const riskReward = avgWin != null && avgLoss != null && avgLoss > 0 ? avgWin / avgLoss : null

  // Equity curve — cumulative P&L in chronological order
  let cumPnl = 0
  const equityCurve = rows.map(r => {
    cumPnl += r.pnl_usd
    return { time: r.time, cumPnl: parseFloat(cumPnl.toFixed(2)) }
  })

  // Annualised Sharpe on daily P&L buckets
  const byDay: Record<string, number> = {}
  for (const r of rows) {
    const day = r.time.slice(0, 10)
    byDay[day] = (byDay[day] ?? 0) + r.pnl_usd
  }
  const dailyReturns = Object.values(byDay)
  let sharpe: number | null = null
  if (dailyReturns.length >= 2) {
    const mean = dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length
    const variance = dailyReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (dailyReturns.length - 1)
    const std = Math.sqrt(variance)
    sharpe = std > 0 ? parseFloat(((mean / std) * Math.sqrt(252)).toFixed(2)) : null
  }

  return {
    totalTicks: totalRows.n,
    totalTrades: rows.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWin,
    avgLoss,
    riskReward,
    sharpe,
    totalPnl: parseFloat(cumPnl.toFixed(2)),
    equityCurve,
  }
}

type CycleRow = {
  id: number; agent_key: string; symbol: string; market: string; paper: number
  decision: string; reason: string; time: string; error: string | null; pnl_usd: number | null
}

function rowToCycle(r: CycleRow): CycleResult & { id: number; agentKey: string } {
  return {
    id: r.id,
    agentKey: r.agent_key,
    symbol: r.symbol,
    market: r.market as 'crypto' | 'mt5',
    paper: r.paper === 1,
    decision: r.decision,
    reason: r.reason,
    time: r.time,
    pnlUsd: r.pnl_usd ?? undefined,
    ...(r.error ? { error: r.error } : {}),
  }
}

export function dbGetCycleResults(market?: string, limit = 500): Array<CycleResult & { id: number; agentKey: string }> {
  const rows = market
    ? db.prepare('SELECT * FROM cycle_results WHERE market = ? ORDER BY id DESC LIMIT ?').all(market, limit)
    : db.prepare('SELECT * FROM cycle_results ORDER BY id DESC LIMIT ?').all(limit)
  return (rows as CycleRow[]).map(rowToCycle)
}

export function dbGetCycleResultsForAgent(agentKey: string, limit = 100): Array<CycleResult & { id: number; agentKey: string }> {
  const rows = db.prepare('SELECT * FROM cycle_results WHERE agent_key = ? ORDER BY id DESC LIMIT ?').all(agentKey, limit) as CycleRow[]
  return rows.map(rowToCycle)
}

export function dbGetCycleById(id: number): (CycleResult & { id: number; agentKey: string }) | null {
  const row = db.prepare('SELECT * FROM cycle_results WHERE id = ?').get(id) as CycleRow | undefined
  return row ? rowToCycle(row) : null
}

export function dbGetLogsForCycle(agentKey: string, cycleEndTime: string): LogEntry[] {
  // SQLite datetime() strips milliseconds and returns 'YYYY-MM-DD HH:MM:SS' which breaks
  // ISO string comparison against 'YYYY-MM-DDTHH:MM:SS.mmmZ'. Compute bounds in JS instead.
  const endMs = new Date(cycleEndTime).getTime()
  const startIso = new Date(endMs - 15 * 60 * 1000).toISOString()
  const endIso   = new Date(endMs + 30 * 1000).toISOString()
  const rows = db.prepare(`
    SELECT * FROM log_entries
    WHERE agent_key = ?
      AND time >= ?
      AND time <= ?
    ORDER BY id ASC
  `).all(agentKey, startIso, endIso) as Array<{
    id: number; time: string; agent_key: string; level: string; event: string; message: string; data: string | null
  }>
  return rows.map(r => ({
    id: r.id,
    time: r.time,
    agentKey: r.agent_key,
    level: r.level as LogEntry['level'],
    event: r.event as LogEntry['event'],
    message: r.message,
    data: r.data ? JSON.parse(r.data) as Record<string, unknown> : undefined,
  }))
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function dbGetLogClearFloor(): number {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('log_clear_floor') as { value: string } | undefined
  if (!row) return 0
  const floor = parseInt(row.value, 10)
  // If the floor exceeds the actual max log ID (e.g. after a DB reset), treat as 0
  // to avoid hiding all logs permanently.
  const maxId = dbGetMaxLogId()
  return floor > maxId ? 0 : floor
}

export function dbSetLogClearFloor(id: number): void {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('log_clear_floor', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(id))
}

// ── Selected account ──────────────────────────────────────────────────────────

export interface SelectedAccount {
  market: 'mt5' | 'crypto'
  accountId: string   // mt5 login as string, or 'binance' for crypto
  label?: string      // e.g. "#1512796653 @ ICMarkets-Demo02"
}

export function dbGetSelectedAccount(): SelectedAccount | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'selected_account'").get() as { value: string } | undefined
  if (!row) return null
  try { return JSON.parse(row.value) as SelectedAccount } catch { return null }
}

export function dbSetSelectedAccount(account: SelectedAccount | null): void {
  if (account === null) {
    db.prepare("DELETE FROM settings WHERE key = 'selected_account'").run()
  } else {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('selected_account', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(account))
  }
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

// ── Memory ───────────────────────────────────────────────────────────────────

export function dbSaveMemory(agentKey: string, category: string, key: string, value: string, confidence: number, ttlHours?: number): void {
  const now = new Date().toISOString()
  const expiresAt = ttlHours ? new Date(Date.now() + ttlHours * 3600000).toISOString() : null
  db.prepare(`
    INSERT INTO agent_memories (agent_key, category, key, value, confidence, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_key, category, key) DO UPDATE SET
      value = excluded.value,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `).run(agentKey, category, key, value, confidence, now, now, expiresAt)
}

export function dbGetMemories(agentKey: string, category?: string, limit = 20): Array<{
  id: number; category: string; key: string; value: string; confidence: number;
  createdAt: string; updatedAt: string; expiresAt: string | null
}> {
  const now = new Date().toISOString()
  let sql = `SELECT * FROM agent_memories WHERE agent_key = ? AND (expires_at IS NULL OR expires_at > ?)`
  const params: unknown[] = [agentKey, now]
  if (category && category !== 'all') { sql += ` AND category = ?`; params.push(category) }
  sql += ` ORDER BY confidence DESC, updated_at DESC LIMIT ?`
  params.push(limit)
  const rows = db.prepare(sql).all(...params) as Array<{
    id: number; category: string; key: string; value: string; confidence: number;
    created_at: string; updated_at: string; expires_at: string | null
  }>
  return rows.map(r => ({ id: r.id, category: r.category, key: r.key, value: r.value, confidence: r.confidence, createdAt: r.created_at, updatedAt: r.updated_at, expiresAt: r.expires_at }))
}

export function dbDeleteMemory(agentKey: string, category: string, key: string): void {
  db.prepare(`DELETE FROM agent_memories WHERE agent_key = ? AND category = ? AND key = ?`).run(agentKey, category, key)
}

export function dbClearMemories(agentKey: string): void {
  db.prepare(`DELETE FROM agent_memories WHERE agent_key = ?`).run(agentKey)
}

/** Wipe ALL data for an agent (memories, strategy, plans, analyses, sessions, cycles, logs).
 *  Config and the agent entry itself are NOT touched. */
export function dbResetAgentData(agentKey: string): { deleted: Record<string, number> } {
  const del = (table: string, col = 'agent_key') =>
    (db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(agentKey)).changes
  const deleted = {
    memories:  del('agent_memories'),
    strategy:  del('agent_strategies'),
    plans:     del('agent_plans'),
    analyses:  del('agent_analyses'),
    sessions:  del('agent_sessions'),
    cycles:    del('cycle_results'),
    logs:      del('log_entries'),
  }
  return { deleted }
}

// ── Strategy ─────────────────────────────────────────────────────────────────

export interface StrategyDoc {
  agentKey: string; name: string; style: string; bias?: string; timeframe?: string;
  entryRules: string; exitRules: string; filters?: string; maxPositions: number; notes?: string;
  createdAt: string; updatedAt: string
}

export function dbSaveStrategy(s: Omit<StrategyDoc, 'createdAt' | 'updatedAt'>): void {
  const now = new Date().toISOString()
  const existing = db.prepare(`SELECT created_at FROM agent_strategies WHERE agent_key = ?`).get(s.agentKey) as { created_at: string } | undefined
  const createdAt = existing?.created_at ?? now
  db.prepare(`
    INSERT INTO agent_strategies (agent_key, name, style, bias, timeframe, entry_rules, exit_rules, filters, max_positions, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_key) DO UPDATE SET
      name = excluded.name, style = excluded.style, bias = excluded.bias,
      timeframe = excluded.timeframe, entry_rules = excluded.entry_rules,
      exit_rules = excluded.exit_rules, filters = excluded.filters,
      max_positions = excluded.max_positions, notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(s.agentKey, s.name, s.style, s.bias ?? null, s.timeframe ?? null, s.entryRules, s.exitRules, s.filters ?? null, s.maxPositions ?? 1, s.notes ?? null, createdAt, now)
}

export function dbGetStrategy(agentKey: string): StrategyDoc | null {
  const row = db.prepare(`SELECT * FROM agent_strategies WHERE agent_key = ?`).get(agentKey) as {
    agent_key: string; name: string; style: string; bias: string | null; timeframe: string | null;
    entry_rules: string; exit_rules: string; filters: string | null; max_positions: number;
    notes: string | null; created_at: string; updated_at: string
  } | undefined
  if (!row) return null
  return { agentKey: row.agent_key, name: row.name, style: row.style, bias: row.bias ?? undefined, timeframe: row.timeframe ?? undefined, entryRules: row.entry_rules, exitRules: row.exit_rules, filters: row.filters ?? undefined, maxPositions: row.max_positions, notes: row.notes ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function dbDeleteStrategy(agentKey: string): void {
  db.prepare(`DELETE FROM agent_strategies WHERE agent_key = ?`).run(agentKey)
}

// ── Plans ─────────────────────────────────────────────────────────────────────

export interface PlanDoc {
  id: number; agentKey: string; sessionDate: string; sessionLabel?: string;
  marketBias: string; keyLevels?: string; riskNotes?: string;
  planText: string; createdAt: string; cycleCountAt?: number; active: boolean
}

export function dbSavePlan(agentKey: string, plan: { marketBias: string; keyLevels?: string; riskNotes?: string; planText: string; sessionLabel?: string; cycleCountAt?: number }): number {
  const now = new Date().toISOString()
  const sessionDate = now.slice(0, 10)
  // Deactivate previous plans for today
  db.prepare(`UPDATE agent_plans SET active = 0 WHERE agent_key = ? AND session_date = ?`).run(agentKey, sessionDate)
  const result = db.prepare(`
    INSERT INTO agent_plans (agent_key, session_date, session_label, market_bias, key_levels, risk_notes, plan_text, created_at, cycle_count_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(agentKey, sessionDate, plan.sessionLabel ?? null, plan.marketBias, plan.keyLevels ?? null, plan.riskNotes ?? null, plan.planText, now, plan.cycleCountAt ?? null) as { lastInsertRowid: number }
  return result.lastInsertRowid as number
}

export function dbGetActivePlan(agentKey: string): PlanDoc | null {
  const today = new Date().toISOString().slice(0, 10)
  const row = db.prepare(`SELECT * FROM agent_plans WHERE agent_key = ? AND session_date = ? AND active = 1 ORDER BY id DESC LIMIT 1`).get(agentKey, today) as {
    id: number; agent_key: string; session_date: string; session_label: string | null;
    market_bias: string; key_levels: string | null; risk_notes: string | null;
    plan_text: string; created_at: string; cycle_count_at: number | null; active: number
  } | undefined
  if (!row) return null
  return { id: row.id, agentKey: row.agent_key, sessionDate: row.session_date, sessionLabel: row.session_label ?? undefined, marketBias: row.market_bias, keyLevels: row.key_levels ?? undefined, riskNotes: row.risk_notes ?? undefined, planText: row.plan_text, createdAt: row.created_at, cycleCountAt: row.cycle_count_at ?? undefined, active: !!row.active }
}

export function dbGetAllPlans(agentKey: string, limit = 10): PlanDoc[] {
  const rows = db.prepare(`SELECT * FROM agent_plans WHERE agent_key = ? ORDER BY id DESC LIMIT ?`).all(agentKey, limit) as Array<{
    id: number; agent_key: string; session_date: string; session_label: string | null;
    market_bias: string; key_levels: string | null; risk_notes: string | null;
    plan_text: string; created_at: string; cycle_count_at: number | null; active: number
  }>
  return rows.map(r => ({ id: r.id, agentKey: r.agent_key, sessionDate: r.session_date, sessionLabel: r.session_label ?? undefined, marketBias: r.market_bias, keyLevels: r.key_levels ?? undefined, riskNotes: r.risk_notes ?? undefined, planText: r.plan_text, createdAt: r.created_at, cycleCountAt: r.cycle_count_at ?? undefined, active: !!r.active }))
}

// ── Agent Sessions (tick-based conversation persistence) ───────────────────────

export interface AgentSessionData {
  agentKey: string
  sessionDate: string
  tickCount: number
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>
  summary: string | null
  createdAt: string
  updatedAt: string
}

export function dbGetTodaySession(agentKey: string): AgentSessionData | null {
  const today = new Date().toISOString().slice(0, 10)
  const row = db.prepare('SELECT * FROM agent_sessions WHERE agent_key = ? AND session_date = ?').get(agentKey, today) as {
    agent_key: string; session_date: string; tick_count: number
    messages: string; summary: string | null; created_at: string; updated_at: string
  } | undefined
  if (!row) return null
  return {
    agentKey: row.agent_key,
    sessionDate: row.session_date,
    tickCount: row.tick_count,
    messages: JSON.parse(row.messages),
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function dbSaveSession(agentKey: string, data: {
  sessionDate: string
  tickCount: number
  messages: unknown[]
  summary?: string | null
}): void {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO agent_sessions (agent_key, session_date, tick_count, messages, summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_key, session_date) DO UPDATE SET
      tick_count = excluded.tick_count,
      messages   = excluded.messages,
      summary    = excluded.summary,
      updated_at = excluded.updated_at
  `).run(agentKey, data.sessionDate, data.tickCount, JSON.stringify(data.messages), data.summary ?? null, now, now)
}

export function dbDeleteSession(agentKey: string, sessionDate: string): void {
  db.prepare('DELETE FROM agent_sessions WHERE agent_key = ? AND session_date = ?').run(agentKey, sessionDate)
}

/** Returns the most recent completed session before today — used for cross-session memory. */
export function dbGetPreviousSession(agentKey: string): AgentSessionData | null {
  const today = new Date().toISOString().slice(0, 10)
  const row = db.prepare(
    'SELECT * FROM agent_sessions WHERE agent_key = ? AND session_date < ? ORDER BY session_date DESC LIMIT 1'
  ).get(agentKey, today) as {
    agent_key: string; session_date: string; tick_count: number
    messages: string; summary: string | null; created_at: string; updated_at: string
  } | undefined
  if (!row) return null
  return {
    agentKey: row.agent_key,
    sessionDate: row.session_date,
    tickCount: row.tick_count,
    messages: JSON.parse(row.messages),
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
