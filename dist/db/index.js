// Wolf-Fin — SQLite persistence layer
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../data/wolf-fin.db');
let db;
export function initDb() {
    mkdirSync(join(__dirname, '../../data'), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000'); // retry writes for up to 5s before SQLITE_BUSY
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
  `);
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
  `);
    // Migration: add pnl_usd column to existing databases
    try {
        db.exec('ALTER TABLE cycle_results ADD COLUMN pnl_usd REAL');
    }
    catch { /* column already exists */ }
    // Migration: add prompt_template and guardrails columns to agents table
    try {
        db.exec('ALTER TABLE agents ADD COLUMN prompt_template TEXT');
    }
    catch { /* column already exists */ }
    try {
        db.exec('ALTER TABLE agents ADD COLUMN guardrails TEXT');
    }
    catch { /* column already exists */ }
    // Keep max_loss_usd for backward compat — new agents won't use it
    try {
        db.exec('ALTER TABLE agents ADD COLUMN max_loss_usd REAL DEFAULT 0');
    }
    catch { /* column already exists */ }
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
    `);
    }
    catch { /* already exists */ }
}
// ── Agents ──────────────────────────────────────────────────────────────────
export function dbGetAllAgents() {
    const rows = db.prepare('SELECT * FROM agents').all();
    return rows.map(row => ({
        config: JSON.parse(row.config),
        status: row.status,
        cycleCount: row.cycle_count,
        startedAt: row.started_at,
        lastCycle: row.last_cycle ? JSON.parse(row.last_cycle) : null,
    }));
}
export function makeAgentKey(market, symbol, mt5AccountId, name) {
    const namePart = name ? `:${name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}` : '';
    if (market === 'mt5' && mt5AccountId)
        return `mt5:${symbol}:${mt5AccountId}${namePart}`;
    return `${market}:${symbol}${namePart}`;
}
export function dbUpsertAgent(agent) {
    const key = makeAgentKey(agent.config.market, agent.config.symbol, agent.config.mt5AccountId, agent.config.name);
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
  `).run(key, JSON.stringify(agent.config), agent.status, agent.cycleCount, agent.startedAt, agent.lastCycle ? JSON.stringify(agent.lastCycle) : null, agent.config.promptTemplate ?? null, agent.config.guardrails ? JSON.stringify(agent.config.guardrails) : null);
}
export function dbRemoveAgent(key) {
    db.prepare('DELETE FROM agents WHERE key = ?').run(key);
}
export function dbUpdateAgentStatus(key, status, startedAt) {
    db.prepare('UPDATE agents SET status = ?, started_at = ? WHERE key = ?').run(status, startedAt, key);
}
// ── Cycle results ────────────────────────────────────────────────────────────
export function dbRecordCycle(key, result) {
    db.prepare(`
    INSERT INTO cycle_results (agent_key, symbol, market, paper, decision, reason, time, error, pnl_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(key, result.symbol, result.market, result.paper ? 1 : 0, result.decision, result.reason, result.time, result.error ?? null, result.pnlUsd ?? null);
}
export function dbGetTodayRealizedPnl(market, dateStr) {
    const row = db.prepare(`
    SELECT COALESCE(SUM(pnl_usd), 0) AS total
    FROM cycle_results
    WHERE market = ? AND date(time) = ? AND paper = 0 AND pnl_usd IS NOT NULL
  `).get(market, dateStr);
    return row.total;
}
export function dbGetAgentPerformance(agentKey, limit = 10) {
    const rows = db.prepare('SELECT decision, reason, time FROM cycle_results WHERE agent_key = ? ORDER BY id DESC LIMIT ?').all(agentKey, Math.max(limit, 50));
    const counts = { buys: 0, sells: 0, holds: 0 };
    for (const r of rows) {
        const d = r.decision.toUpperCase();
        if (d.startsWith('BUY'))
            counts.buys++;
        else if (d.startsWith('SELL'))
            counts.sells++;
        else if (d.startsWith('HOLD'))
            counts.holds++;
    }
    return {
        totalCycles: rows.length,
        ...counts,
        lastDecisions: rows.slice(0, limit).map(r => ({ decision: r.decision, reason: r.reason, time: r.time })),
    };
}
export function dbGetAgentStats(agentKey, limit = 1000) {
    const rows = db.prepare('SELECT time, pnl_usd FROM cycle_results WHERE agent_key = ? AND pnl_usd IS NOT NULL ORDER BY id ASC LIMIT ?').all(agentKey, limit);
    const totalRows = db.prepare('SELECT COUNT(*) as n FROM cycle_results WHERE agent_key = ?').get(agentKey);
    const wins = rows.filter(r => r.pnl_usd > 0);
    const losses = rows.filter(r => r.pnl_usd < 0);
    const winRate = rows.length > 0 ? wins.length / rows.length : null;
    const avgWin = wins.length > 0 ? wins.reduce((s, r) => s + r.pnl_usd, 0) / wins.length : null;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, r) => s + r.pnl_usd, 0) / losses.length) : null;
    const riskReward = avgWin != null && avgLoss != null && avgLoss > 0 ? avgWin / avgLoss : null;
    // Equity curve — cumulative P&L in chronological order
    let cumPnl = 0;
    const equityCurve = rows.map(r => {
        cumPnl += r.pnl_usd;
        return { time: r.time, cumPnl: parseFloat(cumPnl.toFixed(2)) };
    });
    // Annualised Sharpe on daily P&L buckets
    const byDay = {};
    for (const r of rows) {
        const day = r.time.slice(0, 10);
        byDay[day] = (byDay[day] ?? 0) + r.pnl_usd;
    }
    const dailyReturns = Object.values(byDay);
    let sharpe = null;
    if (dailyReturns.length >= 2) {
        const mean = dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length;
        const variance = dailyReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (dailyReturns.length - 1);
        const std = Math.sqrt(variance);
        sharpe = std > 0 ? parseFloat(((mean / std) * Math.sqrt(252)).toFixed(2)) : null;
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
    };
}
function rowToCycle(r) {
    return {
        id: r.id,
        agentKey: r.agent_key,
        symbol: r.symbol,
        market: r.market,
        paper: r.paper === 1,
        decision: r.decision,
        reason: r.reason,
        time: r.time,
        pnlUsd: r.pnl_usd ?? undefined,
        ...(r.error ? { error: r.error } : {}),
    };
}
export function dbGetCycleResults(market, limit = 500) {
    const rows = market
        ? db.prepare('SELECT * FROM cycle_results WHERE market = ? ORDER BY id DESC LIMIT ?').all(market, limit)
        : db.prepare('SELECT * FROM cycle_results ORDER BY id DESC LIMIT ?').all(limit);
    return rows.map(rowToCycle);
}
export function dbGetCycleResultsForAgent(agentKey, limit = 100) {
    const rows = db.prepare('SELECT * FROM cycle_results WHERE agent_key = ? ORDER BY id DESC LIMIT ?').all(agentKey, limit);
    return rows.map(rowToCycle);
}
export function dbGetCycleById(id) {
    const row = db.prepare('SELECT * FROM cycle_results WHERE id = ?').get(id);
    return row ? rowToCycle(row) : null;
}
export function dbGetLogsForCycle(agentKey, cycleEndTime) {
    // SQLite datetime() strips milliseconds and returns 'YYYY-MM-DD HH:MM:SS' which breaks
    // ISO string comparison against 'YYYY-MM-DDTHH:MM:SS.mmmZ'. Compute bounds in JS instead.
    const endMs = new Date(cycleEndTime).getTime();
    const startIso = new Date(endMs - 15 * 60 * 1000).toISOString();
    const endIso = new Date(endMs + 30 * 1000).toISOString();
    const rows = db.prepare(`
    SELECT * FROM log_entries
    WHERE agent_key = ?
      AND time >= ?
      AND time <= ?
    ORDER BY id ASC
  `).all(agentKey, startIso, endIso);
    return rows.map(r => ({
        id: r.id,
        time: r.time,
        agentKey: r.agent_key,
        level: r.level,
        event: r.event,
        message: r.message,
        data: r.data ? JSON.parse(r.data) : undefined,
    }));
}
// ── Settings ─────────────────────────────────────────────────────────────────
export function dbGetLogClearFloor() {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('log_clear_floor');
    if (!row)
        return 0;
    const floor = parseInt(row.value, 10);
    // If the floor exceeds the actual max log ID (e.g. after a DB reset), treat as 0
    // to avoid hiding all logs permanently.
    const maxId = dbGetMaxLogId();
    return floor > maxId ? 0 : floor;
}
export function dbSetLogClearFloor(id) {
    db.prepare(`
    INSERT INTO settings (key, value) VALUES ('log_clear_floor', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(id));
}
export function dbGetSelectedAccount() {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'selected_account'").get();
    if (!row)
        return null;
    try {
        return JSON.parse(row.value);
    }
    catch {
        return null;
    }
}
export function dbSetSelectedAccount(account) {
    if (account === null) {
        db.prepare("DELETE FROM settings WHERE key = 'selected_account'").run();
    }
    else {
        db.prepare(`
      INSERT INTO settings (key, value) VALUES ('selected_account', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(account));
    }
}
// ── Log entries ──────────────────────────────────────────────────────────────
export function dbGetMaxLogId() {
    const row = db.prepare('SELECT MAX(id) as maxId FROM log_entries').get();
    return row?.maxId ?? 0;
}
// ── Log batching: buffer writes and flush in a single transaction ────────────
const logBuffer = [];
let logFlushTimer = null;
const LOG_FLUSH_INTERVAL_MS = 2000;
function flushLogBuffer() {
    if (logBuffer.length === 0)
        return;
    const batch = logBuffer.splice(0);
    const insertStmt = db.prepare(`
    INSERT INTO log_entries (id, time, agent_key, level, event, message, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
    const insertMany = db.transaction((entries) => {
        for (const e of entries) {
            insertStmt.run(e.id, e.time, e.agentKey, e.level, e.event, e.message, e.data ? JSON.stringify(e.data) : null);
        }
    });
    try {
        insertMany(batch);
    }
    catch (err) {
        console.error('[db] log flush failed:', err);
    }
}
export function dbLogEvent(entry) {
    logBuffer.push(entry);
    if (!logFlushTimer) {
        logFlushTimer = setTimeout(() => {
            logFlushTimer = null;
            flushLogBuffer();
        }, LOG_FLUSH_INTERVAL_MS);
    }
}
/** Force-flush pending log entries (call before process exit) */
export function dbFlushLogs() {
    if (logFlushTimer) {
        clearTimeout(logFlushTimer);
        logFlushTimer = null;
    }
    flushLogBuffer();
}
export function dbGetLogs(sinceId, agentKey, limit = 200) {
    let sql;
    let params;
    if (sinceId && agentKey) {
        sql = 'SELECT * FROM log_entries WHERE id > ? AND agent_key = ? ORDER BY id DESC LIMIT ?';
        params = [sinceId, agentKey, limit];
    }
    else if (sinceId) {
        sql = 'SELECT * FROM log_entries WHERE id > ? ORDER BY id DESC LIMIT ?';
        params = [sinceId, limit];
    }
    else if (agentKey) {
        sql = 'SELECT * FROM log_entries WHERE agent_key = ? ORDER BY id DESC LIMIT ?';
        params = [agentKey, limit];
    }
    else {
        sql = 'SELECT * FROM log_entries ORDER BY id DESC LIMIT ?';
        params = [limit];
    }
    const rows = db.prepare(sql).all(...params);
    return rows.map(r => ({
        id: r.id,
        time: r.time,
        agentKey: r.agent_key,
        level: r.level,
        event: r.event,
        message: r.message,
        ...(r.data ? { data: JSON.parse(r.data) } : {}),
    }));
}
// ── Memory ───────────────────────────────────────────────────────────────────
export function dbSaveMemory(agentKey, category, key, value, confidence, ttlHours) {
    const now = new Date().toISOString();
    const expiresAt = ttlHours ? new Date(Date.now() + ttlHours * 3600000).toISOString() : null;
    db.prepare(`
    INSERT INTO agent_memories (agent_key, category, key, value, confidence, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_key, category, key) DO UPDATE SET
      value = excluded.value,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `).run(agentKey, category, key, value, confidence, now, now, expiresAt);
}
export function dbGetMemories(agentKey, category, limit = 20) {
    const now = new Date().toISOString();
    let sql = `SELECT * FROM agent_memories WHERE agent_key = ? AND (expires_at IS NULL OR expires_at > ?)`;
    const params = [agentKey, now];
    if (category && category !== 'all') {
        sql += ` AND category = ?`;
        params.push(category);
    }
    sql += ` ORDER BY confidence DESC, updated_at DESC LIMIT ?`;
    params.push(limit);
    const rows = db.prepare(sql).all(...params);
    return rows.map(r => ({ id: r.id, category: r.category, key: r.key, value: r.value, confidence: r.confidence, createdAt: r.created_at, updatedAt: r.updated_at, expiresAt: r.expires_at }));
}
export function dbDeleteMemory(agentKey, category, key) {
    db.prepare(`DELETE FROM agent_memories WHERE agent_key = ? AND category = ? AND key = ?`).run(agentKey, category, key);
}
export function dbClearMemories(agentKey) {
    db.prepare(`DELETE FROM agent_memories WHERE agent_key = ?`).run(agentKey);
}
/** Wipe ALL data for an agent (memories, strategy, plans, analyses, sessions, cycles, logs).
 *  Config and the agent entry itself are NOT touched. */
export function dbResetAgentData(agentKey) {
    const del = (table, col = 'agent_key') => (db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(agentKey)).changes;
    // Wrap all deletes in a single transaction to avoid write contention
    const resetTx = db.transaction(() => ({
        memories: del('agent_memories'),
        strategy: del('agent_strategies'),
        plans: del('agent_plans'),
        analyses: del('agent_analyses'),
        sessions: del('agent_sessions'),
        cycles: del('cycle_results'),
        logs: del('log_entries'),
    }));
    return { deleted: resetTx() };
}
export function dbSaveStrategy(s) {
    const now = new Date().toISOString();
    const existing = db.prepare(`SELECT created_at FROM agent_strategies WHERE agent_key = ?`).get(s.agentKey);
    const createdAt = existing?.created_at ?? now;
    db.prepare(`
    INSERT INTO agent_strategies (agent_key, name, style, bias, timeframe, entry_rules, exit_rules, filters, max_positions, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_key) DO UPDATE SET
      name = excluded.name, style = excluded.style, bias = excluded.bias,
      timeframe = excluded.timeframe, entry_rules = excluded.entry_rules,
      exit_rules = excluded.exit_rules, filters = excluded.filters,
      max_positions = excluded.max_positions, notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(s.agentKey, s.name, s.style, s.bias ?? null, s.timeframe ?? null, s.entryRules, s.exitRules, s.filters ?? null, s.maxPositions ?? 1, s.notes ?? null, createdAt, now);
}
export function dbGetStrategy(agentKey) {
    const row = db.prepare(`SELECT * FROM agent_strategies WHERE agent_key = ?`).get(agentKey);
    if (!row)
        return null;
    return { agentKey: row.agent_key, name: row.name, style: row.style, bias: row.bias ?? undefined, timeframe: row.timeframe ?? undefined, entryRules: row.entry_rules, exitRules: row.exit_rules, filters: row.filters ?? undefined, maxPositions: row.max_positions, notes: row.notes ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function dbDeleteStrategy(agentKey) {
    db.prepare(`DELETE FROM agent_strategies WHERE agent_key = ?`).run(agentKey);
}
export function dbSavePlan(agentKey, plan) {
    const now = new Date().toISOString();
    const sessionDate = now.slice(0, 10);
    // Deactivate previous plans for today
    db.prepare(`UPDATE agent_plans SET active = 0 WHERE agent_key = ? AND session_date = ?`).run(agentKey, sessionDate);
    const result = db.prepare(`
    INSERT INTO agent_plans (agent_key, session_date, session_label, market_bias, key_levels, risk_notes, plan_text, created_at, cycle_count_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(agentKey, sessionDate, plan.sessionLabel ?? null, plan.marketBias, plan.keyLevels ?? null, plan.riskNotes ?? null, plan.planText, now, plan.cycleCountAt ?? null);
    return result.lastInsertRowid;
}
export function dbGetActivePlan(agentKey) {
    const today = new Date().toISOString().slice(0, 10);
    const row = db.prepare(`SELECT * FROM agent_plans WHERE agent_key = ? AND session_date = ? AND active = 1 ORDER BY id DESC LIMIT 1`).get(agentKey, today);
    if (!row)
        return null;
    return { id: row.id, agentKey: row.agent_key, sessionDate: row.session_date, sessionLabel: row.session_label ?? undefined, marketBias: row.market_bias, keyLevels: row.key_levels ?? undefined, riskNotes: row.risk_notes ?? undefined, planText: row.plan_text, createdAt: row.created_at, cycleCountAt: row.cycle_count_at ?? undefined, active: !!row.active };
}
export function dbGetAllPlans(agentKey, limit = 10) {
    const rows = db.prepare(`SELECT * FROM agent_plans WHERE agent_key = ? ORDER BY id DESC LIMIT ?`).all(agentKey, limit);
    return rows.map(r => ({ id: r.id, agentKey: r.agent_key, sessionDate: r.session_date, sessionLabel: r.session_label ?? undefined, marketBias: r.market_bias, keyLevels: r.key_levels ?? undefined, riskNotes: r.risk_notes ?? undefined, planText: r.plan_text, createdAt: r.created_at, cycleCountAt: r.cycle_count_at ?? undefined, active: !!r.active }));
}
export function dbGetTodaySession(agentKey) {
    const today = new Date().toISOString().slice(0, 10);
    const row = db.prepare('SELECT * FROM agent_sessions WHERE agent_key = ? AND session_date = ?').get(agentKey, today);
    if (!row)
        return null;
    return {
        agentKey: row.agent_key,
        sessionDate: row.session_date,
        tickCount: row.tick_count,
        messages: JSON.parse(row.messages),
        summary: row.summary,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
export function dbSaveSession(agentKey, data) {
    const now = new Date().toISOString();
    db.prepare(`
    INSERT INTO agent_sessions (agent_key, session_date, tick_count, messages, summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_key, session_date) DO UPDATE SET
      tick_count = excluded.tick_count,
      messages   = excluded.messages,
      summary    = excluded.summary,
      updated_at = excluded.updated_at
  `).run(agentKey, data.sessionDate, data.tickCount, JSON.stringify(data.messages), data.summary ?? null, now, now);
}
export function dbDeleteSession(agentKey, sessionDate) {
    db.prepare('DELETE FROM agent_sessions WHERE agent_key = ? AND session_date = ?').run(agentKey, sessionDate);
}
/** Returns the most recent completed session before today — used for cross-session memory. */
export function dbGetPreviousSession(agentKey) {
    const today = new Date().toISOString().slice(0, 10);
    const row = db.prepare('SELECT * FROM agent_sessions WHERE agent_key = ? AND session_date < ? ORDER BY session_date DESC LIMIT 1').get(agentKey, today);
    if (!row)
        return null;
    return {
        agentKey: row.agent_key,
        sessionDate: row.session_date,
        tickCount: row.tick_count,
        messages: JSON.parse(row.messages),
        summary: row.summary,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
//# sourceMappingURL=index.js.map