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
    db.pragma('busy_timeout = 5000');
    db.exec(`
    CREATE TABLE IF NOT EXISTS watch_symbols (
      key                  TEXT PRIMARY KEY,
      symbol               TEXT NOT NULL,
      market               TEXT NOT NULL DEFAULT 'mt5',
      display_name         TEXT,
      mt5_account_id       INTEGER,
      schedule_enabled     INTEGER NOT NULL DEFAULT 0,
      schedule_interval_ms INTEGER,
      schedule_start_utc   TEXT,
      schedule_end_utc     TEXT,
      indicator_config     TEXT,
      candle_config        TEXT,
      context_config       TEXT,
      llm_provider         TEXT,
      llm_model            TEXT,
      created_at           TEXT NOT NULL,
      last_analysis_at     TEXT
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol_key   TEXT NOT NULL,
      symbol       TEXT NOT NULL,
      market       TEXT NOT NULL,
      timeframe    TEXT NOT NULL,
      time         TEXT NOT NULL,
      bias         TEXT,
      summary      TEXT,
      key_levels   TEXT,
      proposal     TEXT,
      indicators   TEXT,
      candles      TEXT,
      context      TEXT,
      llm_provider TEXT,
      llm_model    TEXT,
      error        TEXT
    );

    CREATE TABLE IF NOT EXISTS log_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      time       TEXT NOT NULL,
      symbol_key TEXT NOT NULL,
      level      TEXT NOT NULL,
      event      TEXT NOT NULL,
      message    TEXT NOT NULL,
      data       TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mt5_accounts (
      login        INTEGER PRIMARY KEY,
      name         TEXT    NOT NULL DEFAULT '',
      server       TEXT    NOT NULL DEFAULT '',
      mode         TEXT    NOT NULL DEFAULT 'DEMO',
      last_seen_at TEXT    NOT NULL,
      in_bridge    INTEGER NOT NULL DEFAULT 1
    );
  `);
    // Index for fast symbol-key lookups
    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_analyses_symbol_key ON analyses(symbol_key, time DESC);
    CREATE INDEX IF NOT EXISTS idx_log_entries_symbol_key ON log_entries(symbol_key, id DESC);
  `);
}
// ── Watch symbols ─────────────────────────────────────────────────────────────
export function dbGetAllSymbols() {
    const rows = db.prepare('SELECT * FROM watch_symbols ORDER BY created_at ASC').all();
    return rows.map(rowToSymbol);
}
export function dbGetSymbol(key) {
    const row = db.prepare('SELECT * FROM watch_symbols WHERE key = ?').get(key);
    return row ? rowToSymbol(row) : null;
}
export function dbUpsertSymbol(sym) {
    db.prepare(`
    INSERT INTO watch_symbols (
      key, symbol, market, display_name, mt5_account_id,
      schedule_enabled, schedule_interval_ms, schedule_start_utc, schedule_end_utc,
      indicator_config, candle_config, context_config,
      llm_provider, llm_model, created_at, last_analysis_at
    ) VALUES (
      @key, @symbol, @market, @displayName, @mt5AccountId,
      @scheduleEnabled, @scheduleIntervalMs, @scheduleStartUtc, @scheduleEndUtc,
      @indicatorConfig, @candleConfig, @contextConfig,
      @llmProvider, @llmModel, @createdAt, @lastAnalysisAt
    )
    ON CONFLICT(key) DO UPDATE SET
      symbol               = excluded.symbol,
      market               = excluded.market,
      display_name         = excluded.display_name,
      mt5_account_id       = excluded.mt5_account_id,
      schedule_enabled     = excluded.schedule_enabled,
      schedule_interval_ms = excluded.schedule_interval_ms,
      schedule_start_utc   = excluded.schedule_start_utc,
      schedule_end_utc     = excluded.schedule_end_utc,
      indicator_config     = excluded.indicator_config,
      candle_config        = excluded.candle_config,
      context_config       = excluded.context_config,
      llm_provider         = excluded.llm_provider,
      llm_model            = excluded.llm_model,
      last_analysis_at     = excluded.last_analysis_at
  `).run({
        key: sym.key,
        symbol: sym.symbol,
        market: sym.market,
        displayName: sym.displayName ?? null,
        mt5AccountId: sym.mt5AccountId ?? null,
        scheduleEnabled: sym.scheduleEnabled ? 1 : 0,
        scheduleIntervalMs: sym.scheduleIntervalMs ?? null,
        scheduleStartUtc: sym.scheduleStartUtc ?? null,
        scheduleEndUtc: sym.scheduleEndUtc ?? null,
        indicatorConfig: sym.indicatorConfig ? JSON.stringify(sym.indicatorConfig) : null,
        candleConfig: sym.candleConfig ? JSON.stringify(sym.candleConfig) : null,
        contextConfig: sym.contextConfig ? JSON.stringify(sym.contextConfig) : null,
        llmProvider: sym.llmProvider ?? null,
        llmModel: sym.llmModel ?? null,
        createdAt: sym.createdAt,
        lastAnalysisAt: sym.lastAnalysisAt ?? null,
    });
}
export function dbDeleteSymbol(key) {
    db.prepare('DELETE FROM watch_symbols WHERE key = ?').run(key);
    db.prepare('DELETE FROM analyses WHERE symbol_key = ?').run(key);
    db.prepare('DELETE FROM log_entries WHERE symbol_key = ?').run(key);
}
export function dbSetLastAnalysisAt(key, time) {
    db.prepare('UPDATE watch_symbols SET last_analysis_at = ? WHERE key = ?').run(time, key);
}
function rowToSymbol(row) {
    return {
        key: row.key,
        symbol: row.symbol,
        market: row.market,
        displayName: row.display_name ?? undefined,
        mt5AccountId: row.mt5_account_id ?? undefined,
        scheduleEnabled: Boolean(row.schedule_enabled),
        scheduleIntervalMs: row.schedule_interval_ms ?? undefined,
        scheduleStartUtc: row.schedule_start_utc ?? undefined,
        scheduleEndUtc: row.schedule_end_utc ?? undefined,
        indicatorConfig: row.indicator_config ? JSON.parse(row.indicator_config) : undefined,
        candleConfig: row.candle_config ? JSON.parse(row.candle_config) : undefined,
        contextConfig: row.context_config ? JSON.parse(row.context_config) : undefined,
        llmProvider: row.llm_provider ?? undefined,
        llmModel: row.llm_model ?? undefined,
        createdAt: row.created_at,
        lastAnalysisAt: row.last_analysis_at ?? undefined,
    };
}
// ── Analyses ──────────────────────────────────────────────────────────────────
export function dbSaveAnalysis(result) {
    const info = db.prepare(`
    INSERT INTO analyses (
      symbol_key, symbol, market, timeframe, time,
      bias, summary, key_levels, proposal, indicators, candles, context,
      llm_provider, llm_model, error
    ) VALUES (
      @symbolKey, @symbol, @market, @timeframe, @time,
      @bias, @summary, @keyLevels, @proposal, @indicators, @candles, @context,
      @llmProvider, @llmModel, @error
    )
  `).run({
        symbolKey: result.symbolKey,
        symbol: result.symbol,
        market: result.market,
        timeframe: result.timeframe,
        time: result.time,
        bias: result.bias ?? null,
        summary: result.summary ?? null,
        keyLevels: JSON.stringify(result.keyLevels ?? []),
        proposal: result.tradeProposal ? JSON.stringify(result.tradeProposal) : null,
        indicators: JSON.stringify(result.indicators ?? {}),
        candles: JSON.stringify(result.candles ?? []),
        context: JSON.stringify(result.context ?? {}),
        llmProvider: result.llmProvider,
        llmModel: result.llmModel,
        error: result.error ?? null,
    });
    return info.lastInsertRowid;
}
export function dbGetAnalyses(symbolKey, limit = 50) {
    const rows = db.prepare('SELECT * FROM analyses WHERE symbol_key = ? ORDER BY time DESC LIMIT ?').all(symbolKey, limit);
    return rows.map(rowToAnalysis);
}
export function dbGetLatestAnalysis(symbolKey) {
    const row = db.prepare('SELECT * FROM analyses WHERE symbol_key = ? ORDER BY time DESC LIMIT 1').get(symbolKey);
    return row ? rowToAnalysis(row) : null;
}
export function dbGetAllRecentAnalyses(limit = 100) {
    const rows = db.prepare('SELECT * FROM analyses ORDER BY time DESC LIMIT ?').all(limit);
    return rows.map(rowToAnalysis);
}
export function dbGetAnalysisById(id) {
    const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(id);
    return row ? rowToAnalysis(row) : null;
}
function rowToAnalysis(row) {
    return {
        id: row.id,
        symbolKey: row.symbol_key,
        symbol: row.symbol,
        market: row.market,
        timeframe: row.timeframe,
        time: row.time,
        bias: (row.bias ?? 'neutral'),
        summary: row.summary ?? '',
        keyLevels: row.key_levels ? JSON.parse(row.key_levels) : [],
        tradeProposal: row.proposal ? JSON.parse(row.proposal) : null,
        indicators: row.indicators ? JSON.parse(row.indicators) : {},
        candles: row.candles ? JSON.parse(row.candles) : [],
        context: row.context ? JSON.parse(row.context) : {},
        llmProvider: row.llm_provider ?? '',
        llmModel: row.llm_model ?? '',
        error: row.error ?? undefined,
    };
}
// ── Logs ──────────────────────────────────────────────────────────────────────
export function dbLogEvent(entry) {
    db.prepare(`
    INSERT INTO log_entries (time, symbol_key, level, event, message, data)
    VALUES (@time, @symbolKey, @level, @event, @message, @data)
  `).run({
        time: entry.time,
        symbolKey: entry.symbolKey,
        level: entry.level,
        event: entry.event,
        message: entry.message,
        data: entry.data ? JSON.stringify(entry.data) : null,
    });
}
export function dbGetLogs(sinceId, symbolKey, limit = 200) {
    let sql = 'SELECT * FROM log_entries';
    const params = [];
    const conditions = [];
    if (sinceId != null) {
        conditions.push('id > ?');
        params.push(sinceId);
    }
    if (symbolKey) {
        conditions.push('symbol_key = ?');
        params.push(symbolKey);
    }
    if (conditions.length)
        sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params);
    return rows.map(r => ({
        id: r.id,
        time: r.time,
        symbolKey: r.symbol_key,
        level: r.level,
        event: r.event,
        message: r.message,
        data: r.data ? JSON.parse(r.data) : undefined,
    }));
}
export function dbGetMaxLogId() {
    const row = db.prepare('SELECT MAX(id) as maxId FROM log_entries').get();
    return row.maxId ?? 0;
}
// ── Settings ──────────────────────────────────────────────────────────────────
export function dbGetSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row?.value ?? null;
}
export function dbSetSetting(key, value) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
export function dbUpsertMt5Accounts(accounts) {
    const stmt = db.prepare(`
    INSERT INTO mt5_accounts (login, name, server, mode, last_seen_at, in_bridge)
    VALUES (@login, @name, @server, @mode, @lastSeenAt, @inBridge)
    ON CONFLICT(login) DO UPDATE SET
      name         = excluded.name,
      server       = excluded.server,
      mode         = excluded.mode,
      last_seen_at = excluded.last_seen_at,
      in_bridge    = excluded.in_bridge
  `);
    for (const a of accounts) {
        stmt.run({ ...a, inBridge: a.inBridge ? 1 : 0 });
    }
}
export function dbMarkMt5AccountsGone() {
    db.prepare('UPDATE mt5_accounts SET in_bridge = 0').run();
}
export function dbGetAllMt5Accounts() {
    const rows = db.prepare('SELECT * FROM mt5_accounts ORDER BY last_seen_at DESC').all();
    return rows.map(r => ({
        login: r.login,
        name: r.name,
        server: r.server,
        mode: r.mode,
        lastSeenAt: r.last_seen_at,
        inBridge: Boolean(r.in_bridge),
    }));
}
// ── Symbol key helper ─────────────────────────────────────────────────────────
export function makeSymbolKey(symbol, mt5AccountId) {
    const base = `mt5:${symbol.toUpperCase()}`;
    return mt5AccountId ? `${base}:${mt5AccountId}` : base;
}
//# sourceMappingURL=index.js.map