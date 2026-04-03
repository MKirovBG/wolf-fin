// Wolf-Fin — SQLite persistence layer

import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { WatchSymbol, AnalysisResult, LogEntry, LogLevel, LogEvent, ProposalValidation, CandlePattern } from '../types.js'
import type { FeatureSnapshot, MarketState } from '../types/market.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, '../../data/wolf-fin.db')

let db: Database.Database

export function initDb(): void {
  mkdirSync(join(__dirname, '../../data'), { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')

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
  `)

  // Outcomes tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS proposal_outcomes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id  INTEGER NOT NULL,
      symbol_key   TEXT NOT NULL,
      direction    TEXT NOT NULL,
      entry_low    REAL NOT NULL,
      entry_high   REAL NOT NULL,
      sl           REAL NOT NULL,
      tp1          REAL,
      tp2          REAL,
      tp3          REAL,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TEXT NOT NULL,
      entered_at   TEXT,
      resolved_at  TEXT,
      exit_price   REAL,
      pips_result  REAL
    )
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_outcomes_symbol_key ON proposal_outcomes(symbol_key);
    CREATE INDEX IF NOT EXISTS idx_outcomes_status ON proposal_outcomes(status);
  `)

  // Migration: add raw_response and llm_thinking to analyses
  const anaCols = db.prepare('PRAGMA table_info(analyses)').all() as Array<{ name: string }>
  const anaColNames = new Set(anaCols.map(c => c.name))
  if (!anaColNames.has('raw_response'))  db.exec(`ALTER TABLE analyses ADD COLUMN raw_response TEXT`)
  if (!anaColNames.has('llm_thinking'))  db.exec(`ALTER TABLE analyses ADD COLUMN llm_thinking TEXT`)
  if (!anaColNames.has('patterns'))      db.exec(`ALTER TABLE analyses ADD COLUMN patterns TEXT`)
  if (!anaColNames.has('validation'))    db.exec(`ALTER TABLE analyses ADD COLUMN validation TEXT`)

  // Migration: add system_prompt and strategy columns to watch_symbols
  const symCols = db.prepare('PRAGMA table_info(watch_symbols)').all() as Array<{ name: string }>
  const symColNames = new Set(symCols.map(c => c.name))
  if (!symColNames.has('system_prompt')) db.exec(`ALTER TABLE watch_symbols ADD COLUMN system_prompt TEXT`)
  if (!symColNames.has('strategy'))      db.exec(`ALTER TABLE watch_symbols ADD COLUMN strategy TEXT`)

  // Migration: log_entries used to have agent_key; rename to symbol_key if needed
  const logCols = db.prepare('PRAGMA table_info(log_entries)').all() as Array<{ name: string }>
  const hasAgentKey  = logCols.some(c => c.name === 'agent_key')
  const hasSymbolKey = logCols.some(c => c.name === 'symbol_key')
  if (hasAgentKey && !hasSymbolKey) {
    db.exec(`ALTER TABLE log_entries ADD COLUMN symbol_key TEXT NOT NULL DEFAULT ''`)
    db.exec(`UPDATE log_entries SET symbol_key = agent_key`)
  }
  if (hasAgentKey) {
    db.exec(`ALTER TABLE log_entries DROP COLUMN agent_key`)
  }

  // Index for fast symbol-key lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_analyses_symbol_key ON analyses(symbol_key, time DESC);
    CREATE INDEX IF NOT EXISTS idx_log_entries_symbol_key ON log_entries(symbol_key, id DESC);
  `)

  // Phase 1: feature snapshots and market states
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_features (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL,
      symbol_key  TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      data        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_features_analysis_id  ON analysis_features(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_features_symbol_key   ON analysis_features(symbol_key, captured_at DESC);

    CREATE TABLE IF NOT EXISTS market_states (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id      INTEGER NOT NULL,
      symbol_key       TEXT NOT NULL,
      captured_at      TEXT NOT NULL,
      regime           TEXT NOT NULL,
      direction        TEXT NOT NULL,
      direction_strength INTEGER NOT NULL,
      volatility       TEXT NOT NULL,
      session_quality  TEXT NOT NULL,
      context_risk     TEXT NOT NULL,
      data             TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_states_analysis_id ON market_states(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_states_symbol_key  ON market_states(symbol_key, captured_at DESC);
  `)

  // Strategies table
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      key          TEXT NOT NULL UNIQUE,
      name         TEXT NOT NULL,
      description  TEXT,
      instructions TEXT NOT NULL,
      is_builtin   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Seed built-in strategies if table is empty
  const stratCount = (db.prepare('SELECT COUNT(*) as n FROM strategies').get() as { n: number }).n
  if (stratCount === 0) {
    const ins = db.prepare(`
      INSERT OR IGNORE INTO strategies (key, name, description, instructions, is_builtin)
      VALUES (@key, @name, @description, @instructions, 1)
    `)
    const seeds = [
      { key: 'price_action', name: 'Price Action',    description: 'Candlestick patterns, market structure, swing points. Minimal indicator reliance.',      instructions: 'Apply pure price action methodology: focus on candlestick patterns (pin bars, engulfing, inside bars), market structure (swing highs/lows, break of structure), and key level reactions. Minimize indicator reliance — let the chart structure lead the analysis.' },
      { key: 'ict',          name: 'ICT / SMC',       description: 'Order Blocks, Fair Value Gaps, BOS/CHoCH, liquidity pools, OTE entries.',                instructions: 'Apply ICT (Inner Circle Trader) concepts: identify Order Blocks (OB), Fair Value Gaps (FVG), Break of Structure (BOS) and Change of Character (CHoCH), liquidity pools above/below swing highs/lows, and Optimal Trade Entries (OTE) within Fibonacci discount/premium zones. Note displacement moves and institutional order flow.' },
      { key: 'trend',        name: 'Trend Following', description: 'EMA alignment, pullbacks to structure, momentum confluence.',                            instructions: 'Focus on trend following: identify the dominant trend using EMA alignment and market structure (higher highs/lows or lower highs/lows). Look for pullbacks to key EMAs or structure confirmed by momentum indicators. All trade proposals must align with the dominant trend direction.' },
      { key: 'swing',        name: 'Swing Trading',   description: 'Multi-session holds, major SR flips, 3:1+ R:R targets.',                                 instructions: 'Focus on swing trading setups with multi-session holding periods and wider targets (3:1+ R:R minimum). Prioritize major support/resistance flips, key structure levels, and consolidation breakouts. Trade proposals should target the next major swing point.' },
      { key: 'scalping',     name: 'Scalping',        description: 'Precision micro-structure entries, tight stops, staged targets.',                         instructions: 'Focus on precision scalping entries. Look for micro-structure setups at key levels with tight stops (0.5–1× ATR). Multiple staged targets are acceptable. Only propose high-probability setups with clear invalidation levels.' },
      { key: 'smc',          name: 'Smart Money',     description: 'Supply/demand zones, premium/discount pricing, BMS confirmation.',                       instructions: 'Apply Smart Money Concepts: identify supply and demand zones based on institutional order flow, classify price within premium/discount using Fibonacci 50% equilibrium, look for Break of Market Structure (BMS) confirmation and mitigation of opposing order blocks before entry.' },
    ]
    for (const s of seeds) ins.run(s)
  }
}

// ── Watch symbols ─────────────────────────────────────────────────────────────

export function dbGetAllSymbols(): WatchSymbol[] {
  const rows = db.prepare('SELECT * FROM watch_symbols ORDER BY created_at ASC').all() as Record<string, unknown>[]
  return rows.map(rowToSymbol)
}

export function dbGetSymbol(key: string): WatchSymbol | null {
  const row = db.prepare('SELECT * FROM watch_symbols WHERE key = ?').get(key) as Record<string, unknown> | undefined
  return row ? rowToSymbol(row) : null
}

export function dbUpsertSymbol(sym: WatchSymbol): void {
  db.prepare(`
    INSERT INTO watch_symbols (
      key, symbol, market, display_name, mt5_account_id,
      schedule_enabled, schedule_interval_ms, schedule_start_utc, schedule_end_utc,
      indicator_config, candle_config, context_config,
      llm_provider, llm_model, strategy, system_prompt,
      created_at, last_analysis_at
    ) VALUES (
      @key, @symbol, @market, @displayName, @mt5AccountId,
      @scheduleEnabled, @scheduleIntervalMs, @scheduleStartUtc, @scheduleEndUtc,
      @indicatorConfig, @candleConfig, @contextConfig,
      @llmProvider, @llmModel, @strategy, @systemPrompt,
      @createdAt, @lastAnalysisAt
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
      strategy             = excluded.strategy,
      system_prompt        = excluded.system_prompt,
      last_analysis_at     = excluded.last_analysis_at
  `).run({
    key:                sym.key,
    symbol:             sym.symbol,
    market:             sym.market,
    displayName:        sym.displayName ?? null,
    mt5AccountId:       sym.mt5AccountId ?? null,
    scheduleEnabled:    sym.scheduleEnabled ? 1 : 0,
    scheduleIntervalMs: sym.scheduleIntervalMs ?? null,
    scheduleStartUtc:   sym.scheduleStartUtc ?? null,
    scheduleEndUtc:     sym.scheduleEndUtc ?? null,
    indicatorConfig:    sym.indicatorConfig ? JSON.stringify(sym.indicatorConfig) : null,
    candleConfig:       sym.candleConfig ? JSON.stringify(sym.candleConfig) : null,
    contextConfig:      sym.contextConfig ? JSON.stringify(sym.contextConfig) : null,
    llmProvider:        sym.llmProvider ?? null,
    llmModel:           sym.llmModel ?? null,
    strategy:           sym.strategy ?? null,
    systemPrompt:       sym.systemPrompt ?? null,
    createdAt:          sym.createdAt,
    lastAnalysisAt:     sym.lastAnalysisAt ?? null,
  })
}

export function dbDeleteSymbol(key: string): void {
  db.prepare('DELETE FROM watch_symbols WHERE key = ?').run(key)
  db.prepare('DELETE FROM analyses WHERE symbol_key = ?').run(key)
  db.prepare('DELETE FROM log_entries WHERE symbol_key = ?').run(key)
}

export function dbSetLastAnalysisAt(key: string, time: string): void {
  db.prepare('UPDATE watch_symbols SET last_analysis_at = ? WHERE key = ?').run(time, key)
}

function rowToSymbol(row: Record<string, unknown>): WatchSymbol {
  return {
    key:                row.key as string,
    symbol:             row.symbol as string,
    market:             (row.market as string) as 'mt5',
    displayName:        (row.display_name as string | null) ?? undefined,
    mt5AccountId:       (row.mt5_account_id as number | null) ?? undefined,
    scheduleEnabled:    Boolean(row.schedule_enabled),
    scheduleIntervalMs: (row.schedule_interval_ms as number | null) ?? undefined,
    scheduleStartUtc:   (row.schedule_start_utc as string | null) ?? undefined,
    scheduleEndUtc:     (row.schedule_end_utc as string | null) ?? undefined,
    indicatorConfig:    row.indicator_config ? JSON.parse(row.indicator_config as string) : undefined,
    candleConfig:       row.candle_config ? JSON.parse(row.candle_config as string) : undefined,
    contextConfig:      row.context_config ? JSON.parse(row.context_config as string) : undefined,
    llmProvider:        (row.llm_provider as string | null) ?? undefined,
    llmModel:           (row.llm_model as string | null) ?? undefined,
    strategy:           (row.strategy as string | null) ?? undefined,
    systemPrompt:       (row.system_prompt as string | null) ?? undefined,
    createdAt:          row.created_at as string,
    lastAnalysisAt:     (row.last_analysis_at as string | null) ?? undefined,
  } as WatchSymbol
}

// ── Analyses ──────────────────────────────────────────────────────────────────

export function dbSaveAnalysis(result: Omit<AnalysisResult, 'id'>): number {
  const info = db.prepare(`
    INSERT INTO analyses (
      symbol_key, symbol, market, timeframe, time,
      bias, summary, key_levels, proposal, indicators, candles, context,
      llm_provider, llm_model, error, raw_response, llm_thinking,
      patterns, validation
    ) VALUES (
      @symbolKey, @symbol, @market, @timeframe, @time,
      @bias, @summary, @keyLevels, @proposal, @indicators, @candles, @context,
      @llmProvider, @llmModel, @error, @rawResponse, @llmThinking,
      @patterns, @validation
    )
  `).run({
    symbolKey:   result.symbolKey,
    symbol:      result.symbol,
    market:      result.market,
    timeframe:   result.timeframe,
    time:        result.time,
    bias:        result.bias ?? null,
    summary:     result.summary ?? null,
    keyLevels:   JSON.stringify(result.keyLevels ?? []),
    proposal:    result.tradeProposal ? JSON.stringify(result.tradeProposal) : null,
    indicators:  JSON.stringify(result.indicators ?? {}),
    candles:     JSON.stringify(result.candles ?? []),
    context:     JSON.stringify(result.context ?? {}),
    llmProvider: result.llmProvider,
    llmModel:    result.llmModel,
    error:       result.error ?? null,
    rawResponse: result.rawResponse ?? null,
    llmThinking: result.llmThinking ?? null,
    patterns:    result.patterns ? JSON.stringify(result.patterns) : null,
    validation:  result.validation ? JSON.stringify(result.validation) : null,
  })
  return info.lastInsertRowid as number
}

export function dbGetAnalyses(symbolKey: string, limit = 50): AnalysisResult[] {
  const rows = db.prepare(
    'SELECT * FROM analyses WHERE symbol_key = ? ORDER BY time DESC LIMIT ?'
  ).all(symbolKey, limit) as Record<string, unknown>[]
  return rows.map(rowToAnalysis)
}

export function dbGetLatestAnalysis(symbolKey: string): AnalysisResult | null {
  const row = db.prepare(
    'SELECT * FROM analyses WHERE symbol_key = ? ORDER BY time DESC LIMIT 1'
  ).get(symbolKey) as Record<string, unknown> | undefined
  return row ? rowToAnalysis(row) : null
}

export function dbGetAllRecentAnalyses(limit = 100): AnalysisResult[] {
  const rows = db.prepare(
    'SELECT * FROM analyses ORDER BY time DESC LIMIT ?'
  ).all(limit) as Record<string, unknown>[]
  return rows.map(rowToAnalysis)
}

export function dbGetAnalysisById(id: number): AnalysisResult | null {
  const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToAnalysis(row) : null
}

function rowToAnalysis(row: Record<string, unknown>): AnalysisResult {
  return {
    id:            row.id as number,
    symbolKey:     row.symbol_key as string,
    symbol:        row.symbol as string,
    market:        row.market as 'mt5',
    timeframe:     row.timeframe as string,
    time:          row.time as string,
    bias:          (row.bias as string ?? 'neutral') as 'bullish' | 'bearish' | 'neutral',
    summary:       (row.summary as string) ?? '',
    keyLevels:     row.key_levels ? JSON.parse(row.key_levels as string) : [],
    tradeProposal: row.proposal ? JSON.parse(row.proposal as string) : null,
    indicators:    row.indicators ? JSON.parse(row.indicators as string) : {},
    candles:       row.candles ? JSON.parse(row.candles as string) : [],
    context:       row.context ? JSON.parse(row.context as string) : {},
    llmProvider:   (row.llm_provider as string) ?? '',
    llmModel:      (row.llm_model as string) ?? '',
    error:         (row.error as string | null) ?? undefined,
    rawResponse:   (row.raw_response as string | null) ?? undefined,
    llmThinking:   (row.llm_thinking as string | null) ?? undefined,
    patterns:      row.patterns    ? JSON.parse(row.patterns as string)    as CandlePattern[]      : undefined,
    validation:    row.validation  ? JSON.parse(row.validation as string)  as ProposalValidation   : undefined,
  }
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export function dbLogEvent(entry: LogEntry): void {
  db.prepare(`
    INSERT INTO log_entries (time, symbol_key, level, event, message, data)
    VALUES (@time, @symbolKey, @level, @event, @message, @data)
  `).run({
    time:      entry.time,
    symbolKey: entry.symbolKey,
    level:     entry.level,
    event:     entry.event,
    message:   entry.message,
    data:      entry.data ? JSON.stringify(entry.data) : null,
  })
}

export function dbGetLogs(sinceId?: number, symbolKey?: string, limit = 200): LogEntry[] {
  let sql = 'SELECT * FROM log_entries'
  const params: unknown[] = []
  const conditions: string[] = []

  if (sinceId != null) { conditions.push('id > ?'); params.push(sinceId) }
  if (symbolKey)       { conditions.push('symbol_key = ?'); params.push(symbolKey) }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ' ORDER BY id DESC LIMIT ?'
  params.push(limit)

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  return rows.map(r => ({
    id:        r.id as number,
    time:      r.time as string,
    symbolKey: r.symbol_key as string,
    level:     r.level as LogLevel,
    event:     r.event as LogEvent,
    message:   r.message as string,
    data:      r.data ? JSON.parse(r.data as string) : undefined,
  }))
}

export function dbGetMaxLogId(): number {
  const row = db.prepare('SELECT MAX(id) as maxId FROM log_entries').get() as { maxId: number | null }
  return row.maxId ?? 0
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function dbGetSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function dbSetSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

// ── MT5 accounts ──────────────────────────────────────────────────────────────

export interface Mt5AccountRow {
  login: number
  name: string
  server: string
  mode: string
  lastSeenAt: string
  inBridge: boolean
}

export function dbUpsertMt5Accounts(accounts: Mt5AccountRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO mt5_accounts (login, name, server, mode, last_seen_at, in_bridge)
    VALUES (@login, @name, @server, @mode, @lastSeenAt, @inBridge)
    ON CONFLICT(login) DO UPDATE SET
      name         = excluded.name,
      server       = excluded.server,
      mode         = excluded.mode,
      last_seen_at = excluded.last_seen_at,
      in_bridge    = excluded.in_bridge
  `)
  for (const a of accounts) {
    stmt.run({ ...a, inBridge: a.inBridge ? 1 : 0 })
  }
}

export function dbMarkMt5AccountsGone(): void {
  db.prepare('UPDATE mt5_accounts SET in_bridge = 0').run()
}

export function dbGetAllMt5Accounts(): Mt5AccountRow[] {
  const rows = db.prepare('SELECT * FROM mt5_accounts ORDER BY last_seen_at DESC').all() as Record<string, unknown>[]
  return rows.map(r => ({
    login:      r.login as number,
    name:       r.name as string,
    server:     r.server as string,
    mode:       r.mode as string,
    lastSeenAt: r.last_seen_at as string,
    inBridge:   Boolean(r.in_bridge),
  }))
}

// ── Symbol key helper ─────────────────────────────────────────────────────────

export function makeSymbolKey(symbol: string, mt5AccountId?: number): string {
  const base = `mt5:${symbol.toUpperCase()}`
  return mt5AccountId ? `${base}:${mt5AccountId}` : base
}

// ── Strategies ────────────────────────────────────────────────────────────────

export interface StrategyRow {
  id:           number
  key:          string
  name:         string
  description:  string | null
  instructions: string
  isBuiltin:    boolean
  createdAt:    string
}

function rowToStrategy(r: Record<string, unknown>): StrategyRow {
  return {
    id:           r.id as number,
    key:          r.key as string,
    name:         r.name as string,
    description:  (r.description as string | null) ?? null,
    instructions: r.instructions as string,
    isBuiltin:    Boolean(r.is_builtin),
    createdAt:    r.created_at as string,
  }
}

export function dbGetAllStrategies(): StrategyRow[] {
  const rows = db.prepare('SELECT * FROM strategies ORDER BY is_builtin DESC, name ASC').all() as Record<string, unknown>[]
  return rows.map(rowToStrategy)
}

export function dbGetStrategy(key: string): StrategyRow | null {
  const row = db.prepare('SELECT * FROM strategies WHERE key = ?').get(key) as Record<string, unknown> | undefined
  return row ? rowToStrategy(row) : null
}

export function dbUpsertStrategy(s: { key: string; name: string; description?: string; instructions: string }): void {
  db.prepare(`
    INSERT INTO strategies (key, name, description, instructions, is_builtin)
    VALUES (@key, @name, @description, @instructions, 0)
    ON CONFLICT(key) DO UPDATE SET
      name         = excluded.name,
      description  = excluded.description,
      instructions = excluded.instructions
  `).run({ key: s.key, name: s.name, description: s.description ?? null, instructions: s.instructions })
}

export function dbDeleteStrategy(key: string): void {
  db.prepare('DELETE FROM strategies WHERE key = ? AND is_builtin = 0').run(key)
}

// ── Proposal outcomes ─────────────────────────────────────────────────────────

export type OutcomeStatus = 'pending' | 'entered' | 'hit_tp1' | 'hit_tp2' | 'hit_sl' | 'expired' | 'invalidated'

export interface ProposalOutcome {
  id:          number
  analysisId:  number
  symbolKey:   string
  direction:   'BUY' | 'SELL'
  entryLow:    number
  entryHigh:   number
  sl:          number
  tp1:         number | null
  tp2:         number | null
  tp3:         number | null
  status:      OutcomeStatus
  createdAt:   string
  enteredAt:   string | null
  resolvedAt:  string | null
  exitPrice:   number | null
  pipsResult:  number | null
}

function rowToOutcome(r: Record<string, unknown>): ProposalOutcome {
  return {
    id:          r.id as number,
    analysisId:  r.analysis_id as number,
    symbolKey:   r.symbol_key as string,
    direction:   r.direction as 'BUY' | 'SELL',
    entryLow:    r.entry_low as number,
    entryHigh:   r.entry_high as number,
    sl:          r.sl as number,
    tp1:         (r.tp1 as number | null) ?? null,
    tp2:         (r.tp2 as number | null) ?? null,
    tp3:         (r.tp3 as number | null) ?? null,
    status:      r.status as OutcomeStatus,
    createdAt:   r.created_at as string,
    enteredAt:   (r.entered_at as string | null) ?? null,
    resolvedAt:  (r.resolved_at as string | null) ?? null,
    exitPrice:   (r.exit_price as number | null) ?? null,
    pipsResult:  (r.pips_result as number | null) ?? null,
  }
}

export function dbCreateOutcome(o: Omit<ProposalOutcome, 'id' | 'enteredAt' | 'resolvedAt' | 'exitPrice' | 'pipsResult'>): number {
  const info = db.prepare(`
    INSERT INTO proposal_outcomes
      (analysis_id, symbol_key, direction, entry_low, entry_high, sl, tp1, tp2, tp3, status, created_at)
    VALUES
      (@analysisId, @symbolKey, @direction, @entryLow, @entryHigh, @sl, @tp1, @tp2, @tp3, @status, @createdAt)
  `).run({
    analysisId: o.analysisId,
    symbolKey:  o.symbolKey,
    direction:  o.direction,
    entryLow:   o.entryLow,
    entryHigh:  o.entryHigh,
    sl:         o.sl,
    tp1:        o.tp1 ?? null,
    tp2:        o.tp2 ?? null,
    tp3:        o.tp3 ?? null,
    status:     o.status,
    createdAt:  o.createdAt,
  })
  return info.lastInsertRowid as number
}

export function dbUpdateOutcomeStatus(
  id: number,
  status: OutcomeStatus,
  fields: { enteredAt?: string; resolvedAt?: string; exitPrice?: number; pipsResult?: number } = {},
): void {
  db.prepare(`
    UPDATE proposal_outcomes
    SET status      = @status,
        entered_at  = COALESCE(@enteredAt,  entered_at),
        resolved_at = COALESCE(@resolvedAt, resolved_at),
        exit_price  = COALESCE(@exitPrice,  exit_price),
        pips_result = COALESCE(@pipsResult, pips_result)
    WHERE id = @id
  `).run({
    id,
    status,
    enteredAt:  fields.enteredAt  ?? null,
    resolvedAt: fields.resolvedAt ?? null,
    exitPrice:  fields.exitPrice  ?? null,
    pipsResult: fields.pipsResult ?? null,
  })
}

export function dbGetPendingOutcomes(): ProposalOutcome[] {
  const rows = db.prepare(
    "SELECT * FROM proposal_outcomes WHERE status IN ('pending', 'entered') ORDER BY created_at ASC"
  ).all() as Record<string, unknown>[]
  return rows.map(rowToOutcome)
}

export function dbGetOutcomes(symbolKey?: string, limit = 100): ProposalOutcome[] {
  let sql = 'SELECT * FROM proposal_outcomes'
  const params: unknown[] = []
  if (symbolKey) {
    sql += ' WHERE symbol_key = ?'
    params.push(symbolKey)
  }
  sql += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  return rows.map(rowToOutcome)
}

export function dbGetOutcomeStats(symbolKey?: string): {
  total: number; entered: number; hitTp1: number; hitTp2: number; hitSl: number; expired: number; winRate: number
} {
  let where = symbolKey ? `WHERE symbol_key = '${symbolKey.replace(/'/g, "''")}'` : ''
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'entered'  THEN 1 ELSE 0 END) as entered,
      SUM(CASE WHEN status = 'hit_tp1'  THEN 1 ELSE 0 END) as hit_tp1,
      SUM(CASE WHEN status = 'hit_tp2'  THEN 1 ELSE 0 END) as hit_tp2,
      SUM(CASE WHEN status = 'hit_sl'   THEN 1 ELSE 0 END) as hit_sl,
      SUM(CASE WHEN status = 'expired'  THEN 1 ELSE 0 END) as expired
    FROM proposal_outcomes ${where}
  `).get() as Record<string, number>

  const resolved = (row.hit_tp1 ?? 0) + (row.hit_tp2 ?? 0) + (row.hit_sl ?? 0)
  const wins     = (row.hit_tp1 ?? 0) + (row.hit_tp2 ?? 0)
  return {
    total:    row.total ?? 0,
    entered:  row.entered ?? 0,
    hitTp1:   row.hit_tp1 ?? 0,
    hitTp2:   row.hit_tp2 ?? 0,
    hitSl:    row.hit_sl ?? 0,
    expired:  row.expired ?? 0,
    winRate:  resolved > 0 ? (wins / resolved) * 100 : 0,
  }
}

// ── Phase 1: Feature snapshots ────────────────────────────────────────────────

export function dbSaveFeatures(features: FeatureSnapshot, analysisId: number): void {
  db.prepare(`
    INSERT INTO analysis_features (analysis_id, symbol_key, captured_at, data)
    VALUES (@analysisId, @symbolKey, @capturedAt, @data)
  `).run({
    analysisId,
    symbolKey:  features.symbolKey,
    capturedAt: features.capturedAt,
    data:       JSON.stringify({ ...features, analysisId }),
  })
}

export function dbGetLatestFeatures(symbolKey: string): FeatureSnapshot | null {
  const row = db.prepare(
    'SELECT data FROM analysis_features WHERE symbol_key = ? ORDER BY captured_at DESC LIMIT 1'
  ).get(symbolKey) as { data: string } | undefined
  return row ? JSON.parse(row.data) as FeatureSnapshot : null
}

export function dbGetFeaturesForAnalysis(analysisId: number): FeatureSnapshot | null {
  const row = db.prepare(
    'SELECT data FROM analysis_features WHERE analysis_id = ? LIMIT 1'
  ).get(analysisId) as { data: string } | undefined
  return row ? JSON.parse(row.data) as FeatureSnapshot : null
}

// ── Phase 1: Market states ────────────────────────────────────────────────────

export function dbSaveMarketState(state: MarketState, analysisId: number): void {
  db.prepare(`
    INSERT INTO market_states
      (analysis_id, symbol_key, captured_at, regime, direction, direction_strength,
       volatility, session_quality, context_risk, data)
    VALUES
      (@analysisId, @symbolKey, @capturedAt, @regime, @direction, @directionStrength,
       @volatility, @sessionQuality, @contextRisk, @data)
  `).run({
    analysisId,
    symbolKey:        state.symbolKey,
    capturedAt:       state.capturedAt,
    regime:           state.regime,
    direction:        state.direction,
    directionStrength: state.directionStrength,
    volatility:       state.volatility,
    sessionQuality:   state.sessionQuality,
    contextRisk:      state.contextRisk,
    data:             JSON.stringify({ ...state, analysisId }),
  })
}

export function dbGetLatestMarketState(symbolKey: string): MarketState | null {
  const row = db.prepare(
    'SELECT data FROM market_states WHERE symbol_key = ? ORDER BY captured_at DESC LIMIT 1'
  ).get(symbolKey) as { data: string } | undefined
  return row ? JSON.parse(row.data) as MarketState : null
}

export function dbGetMarketStateForAnalysis(analysisId: number): MarketState | null {
  const row = db.prepare(
    'SELECT data FROM market_states WHERE analysis_id = ? LIMIT 1'
  ).get(analysisId) as { data: string } | undefined
  return row ? JSON.parse(row.data) as MarketState : null
}
