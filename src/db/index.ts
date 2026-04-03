// Wolf-Fin — SQLite persistence layer

import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { WatchSymbol, AnalysisResult, LogEntry, LogLevel, LogEvent, ProposalValidation, CandlePattern, ReasoningStep } from '../types.js'
import type { FeatureSnapshot, MarketState } from '../types/market.js'
import { runMigrations, getMigrationStatus } from './migrations.js'

export {
  dbSaveCandidates, dbGetCandidatesForAnalysis, dbGetLatestCandidates,
  dbSaveStrategyVersion, dbGetStrategyVersions, dbUpdateStrategyDefinition,
  dbCreateBacktestRun, dbCompleteBacktestRun, dbFailBacktestRun, dbGetBacktestRun, dbSaveBacktestTrades,
  dbCreateAlertRule, dbGetAlertRules, dbToggleAlertRule, dbDeleteAlertRule,
  dbFireAlert, dbGetAlertFirings, dbAcknowledgeAlert, dbGetLatestFeatureHistory,
} from './phase25.js'
import { initPhase25 } from './phase25.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, '../../data/wolf-fin.db')

let db: Database.Database

export function initDb(): void {
  mkdirSync(join(__dirname, '../../data'), { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  initPhase25(db)
  runMigrations(db)
}

/** Expose migration status for the health endpoint. */
export function dbGetMigrationStatus() {
  return getMigrationStatus(db)
}

/**
 * Prune old log entries, keeping only the most recent `maxEntries`.
 * Returns the number of rows deleted.
 */
export function dbPruneLogs(maxEntries = 10_000): number {
  const { n } = db.prepare('SELECT COUNT(*) as n FROM log_entries').get() as { n: number }
  if (n <= maxEntries) return 0
  const toDelete = n - maxEntries
  db.prepare(`
    DELETE FROM log_entries WHERE id IN (
      SELECT id FROM log_entries ORDER BY id ASC LIMIT ?
    )
  `).run(toDelete)
  return toDelete
}

/**
 * Run SQLite integrity_check and return the result lines.
 * Returns ['ok'] when the database is healthy.
 */
export function dbCheckIntegrity(): string[] {
  const rows = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>
  return rows.map(r => r.integrity_check)
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
      llm_provider, llm_model, strategy, system_prompt, notify_mode,
      created_at, last_analysis_at
    ) VALUES (
      @key, @symbol, @market, @displayName, @mt5AccountId,
      @scheduleEnabled, @scheduleIntervalMs, @scheduleStartUtc, @scheduleEndUtc,
      @indicatorConfig, @candleConfig, @contextConfig,
      @llmProvider, @llmModel, @strategy, @systemPrompt, @notifyMode,
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
      notify_mode          = excluded.notify_mode,
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
    notifyMode:         sym.notifyMode ?? 'all',
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
    notifyMode:         (row.notify_mode as 'all' | 'trade_only' | 'off' | null) ?? undefined,
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
      patterns, validation, strategy_key, reasoning_chain, system_prompt
    ) VALUES (
      @symbolKey, @symbol, @market, @timeframe, @time,
      @bias, @summary, @keyLevels, @proposal, @indicators, @candles, @context,
      @llmProvider, @llmModel, @error, @rawResponse, @llmThinking,
      @patterns, @validation, @strategyKey, @reasoningChain, @systemPrompt
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
    validation:      result.validation ? JSON.stringify(result.validation) : null,
    strategyKey:     result.strategyKey ?? null,
    reasoningChain:  result.reasoningChain ? JSON.stringify(result.reasoningChain) : null,
    systemPrompt:    result.systemPrompt ?? null,
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
    patterns:       row.patterns        ? JSON.parse(row.patterns as string)        as CandlePattern[]      : undefined,
    validation:     row.validation      ? JSON.parse(row.validation as string)      as ProposalValidation   : undefined,
    reasoningChain: row.reasoning_chain ? JSON.parse(row.reasoning_chain as string) as ReasoningStep[]      : undefined,
    strategyKey:    (row.strategy_key as string | null) ?? undefined,
    systemPrompt:   (row.system_prompt as string | null) ?? undefined,
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

// ── Analysis feedback ─────────────────────────────────────────────────────────

export interface AnalysisFeedbackRow {
  id:         number
  analysisId: number
  rating:     number | null
  comment:    string | null
  createdAt:  string
}

export function dbSaveFeedback(analysisId: number, rating: number | null, comment: string | null): number {
  const info = db.prepare(`
    INSERT INTO analysis_feedback (analysis_id, rating, comment)
    VALUES (?, ?, ?)
  `).run(analysisId, rating, comment)
  return info.lastInsertRowid as number
}

export function dbGetFeedback(analysisId: number): AnalysisFeedbackRow[] {
  const rows = db.prepare(
    'SELECT * FROM analysis_feedback WHERE analysis_id = ? ORDER BY created_at DESC'
  ).all(analysisId) as Record<string, unknown>[]
  return rows.map(r => ({
    id:         r.id as number,
    analysisId: r.analysis_id as number,
    rating:     (r.rating as number | null) ?? null,
    comment:    (r.comment as string | null) ?? null,
    createdAt:  r.created_at as string,
  }))
}

// ── Agent memories ───────────────────────────────────────────────────────────

export interface AgentMemoryRow {
  id:               number
  symbol:           string | null
  category:         string
  content:          string
  confidence:       number
  sourceAnalysisId: number | null
  createdAt:        string
  expiresAt:        string | null
  active:           boolean
}

function rowToMemory(r: Record<string, unknown>): AgentMemoryRow {
  return {
    id:               r.id as number,
    symbol:           (r.symbol as string | null) ?? null,
    category:         r.category as string,
    content:          r.content as string,
    confidence:       r.confidence as number,
    sourceAnalysisId: (r.source_analysis_id as number | null) ?? null,
    createdAt:        r.created_at as string,
    expiresAt:        (r.expires_at as string | null) ?? null,
    active:           Boolean(r.active),
  }
}

export function dbGetMemories(opts?: { symbol?: string; category?: string; activeOnly?: boolean }): AgentMemoryRow[] {
  let sql = 'SELECT * FROM agent_memories'
  const conditions: string[] = []
  const params: unknown[] = []
  if (opts?.symbol)     { conditions.push('symbol = ?'); params.push(opts.symbol) }
  if (opts?.category)   { conditions.push('category = ?'); params.push(opts.category) }
  if (opts?.activeOnly !== false) { conditions.push('active = 1') }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ' ORDER BY created_at DESC'
  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToMemory)
}

export function dbSaveMemory(mem: { symbol?: string; category: string; content: string; confidence?: number; sourceAnalysisId?: number; expiresAt?: string }): number {
  const info = db.prepare(`
    INSERT INTO agent_memories (symbol, category, content, confidence, source_analysis_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(mem.symbol ?? null, mem.category, mem.content, mem.confidence ?? 0.5, mem.sourceAnalysisId ?? null, mem.expiresAt ?? null)
  return info.lastInsertRowid as number
}

export function dbUpdateMemory(id: number, patch: { active?: boolean; content?: string; confidence?: number }): void {
  const sets: string[] = []
  const params: unknown[] = []
  if (patch.active != null)     { sets.push('active = ?'); params.push(patch.active ? 1 : 0) }
  if (patch.content != null)    { sets.push('content = ?'); params.push(patch.content) }
  if (patch.confidence != null) { sets.push('confidence = ?'); params.push(patch.confidence) }
  if (sets.length === 0) return
  params.push(id)
  db.prepare(`UPDATE agent_memories SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function dbDeleteMemory(id: number): void {
  db.prepare('DELETE FROM agent_memories WHERE id = ?').run(id)
}

export function dbPurgeExpiredMemories(): number {
  const now = new Date().toISOString()
  const info = db.prepare(
    `UPDATE agent_memories SET active = 0 WHERE expires_at IS NOT NULL AND expires_at < ? AND active = 1`
  ).run(now)
  return info.changes
}

export function dbGetAnalysesSince(since: string): AnalysisResult[] {
  const rows = db.prepare(
    'SELECT * FROM analyses WHERE time >= ? AND error IS NULL ORDER BY time ASC'
  ).all(since) as Record<string, unknown>[]
  return rows.map(rowToAnalysis)
}

export function dbCountActiveMemories(symbol?: string): number {
  if (symbol) {
    return (db.prepare('SELECT COUNT(*) as cnt FROM agent_memories WHERE active = 1 AND symbol = ?').get(symbol) as { cnt: number }).cnt
  }
  return (db.prepare('SELECT COUNT(*) as cnt FROM agent_memories WHERE active = 1').get() as { cnt: number }).cnt
}

// ── Agent rules ──────────────────────────────────────────────────────────────

export interface AgentRuleRow {
  id:         number
  ruleText:   string
  scope:      string
  scopeValue: string | null
  priority:   number
  enabled:    boolean
  createdAt:  string
}

function rowToRule(r: Record<string, unknown>): AgentRuleRow {
  return {
    id:         r.id as number,
    ruleText:   r.rule_text as string,
    scope:      r.scope as string,
    scopeValue: (r.scope_value as string | null) ?? null,
    priority:   r.priority as number,
    enabled:    Boolean(r.enabled),
    createdAt:  r.created_at as string,
  }
}

export function dbGetRules(opts?: { scope?: string; enabledOnly?: boolean }): AgentRuleRow[] {
  let sql = 'SELECT * FROM agent_rules'
  const conditions: string[] = []
  const params: unknown[] = []
  if (opts?.scope)      { conditions.push('scope = ?'); params.push(opts.scope) }
  if (opts?.enabledOnly !== false) { conditions.push('enabled = 1') }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ' ORDER BY priority DESC, created_at ASC'
  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToRule)
}

export function dbGetActiveRules(symbol?: string): AgentRuleRow[] {
  const sql = `
    SELECT * FROM agent_rules
    WHERE enabled = 1 AND (scope = 'global' OR (scope = 'symbol' AND scope_value = ?))
    ORDER BY priority DESC, created_at ASC
  `
  return (db.prepare(sql).all(symbol ?? null) as Record<string, unknown>[]).map(rowToRule)
}

export function dbSaveRule(rule: { ruleText: string; scope?: string; scopeValue?: string; priority?: number }): number {
  const info = db.prepare(`
    INSERT INTO agent_rules (rule_text, scope, scope_value, priority)
    VALUES (?, ?, ?, ?)
  `).run(rule.ruleText, rule.scope ?? 'global', rule.scopeValue ?? null, rule.priority ?? 0)
  return info.lastInsertRowid as number
}

export function dbUpdateRule(id: number, patch: { ruleText?: string; scope?: string; scopeValue?: string; priority?: number; enabled?: boolean }): void {
  const sets: string[] = []
  const params: unknown[] = []
  if (patch.ruleText != null)   { sets.push('rule_text = ?'); params.push(patch.ruleText) }
  if (patch.scope != null)      { sets.push('scope = ?'); params.push(patch.scope) }
  if (patch.scopeValue != null) { sets.push('scope_value = ?'); params.push(patch.scopeValue) }
  if (patch.priority != null)   { sets.push('priority = ?'); params.push(patch.priority) }
  if (patch.enabled != null)    { sets.push('enabled = ?'); params.push(patch.enabled ? 1 : 0) }
  if (sets.length === 0) return
  params.push(id)
  db.prepare(`UPDATE agent_rules SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function dbDeleteRule(id: number): void {
  db.prepare('DELETE FROM agent_rules WHERE id = ?').run(id)
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
  definition?:  string | null   // Phase 3: structured JSON definition
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
    definition:   (r.definition as string | null) ?? null,
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

// ── Symbol strategies (multi-strategy assignment) ────────────────────────────

export interface SymbolStrategyRow {
  symbolKey:   string
  strategyKey: string
  enabled:     boolean
  addedAt:     string
}

export function dbGetSymbolStrategies(symbolKey: string): SymbolStrategyRow[] {
  const rows = db.prepare(
    'SELECT * FROM symbol_strategies WHERE symbol_key = ? ORDER BY added_at ASC'
  ).all(symbolKey) as Record<string, unknown>[]
  return rows.map(r => ({
    symbolKey:   r.symbol_key as string,
    strategyKey: r.strategy_key as string,
    enabled:     Boolean(r.enabled),
    addedAt:     r.added_at as string,
  }))
}

export function dbAddSymbolStrategy(symbolKey: string, strategyKey: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO symbol_strategies (symbol_key, strategy_key)
    VALUES (?, ?)
  `).run(symbolKey, strategyKey)
}

export function dbRemoveSymbolStrategy(symbolKey: string, strategyKey: string): void {
  db.prepare('DELETE FROM symbol_strategies WHERE symbol_key = ? AND strategy_key = ?')
    .run(symbolKey, strategyKey)
}

export function dbToggleSymbolStrategy(symbolKey: string, strategyKey: string, enabled: boolean): void {
  db.prepare('UPDATE symbol_strategies SET enabled = ? WHERE symbol_key = ? AND strategy_key = ?')
    .run(enabled ? 1 : 0, symbolKey, strategyKey)
}

export function dbGetAllSymbolStrategies(): SymbolStrategyRow[] {
  const rows = db.prepare('SELECT * FROM symbol_strategies ORDER BY strategy_key, symbol_key').all() as Record<string, unknown>[]
  return rows.map(r => ({
    symbolKey:   r.symbol_key as string,
    strategyKey: r.strategy_key as string,
    enabled:     Boolean(r.enabled),
    addedAt:     r.added_at as string,
  }))
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

// ── Account Snapshots ─────────────────────────────────────────────────────────

export interface AccountSnapshot {
  id: number
  login: number
  balance: number
  equity: number
  margin: number
  freeMargin: number
  floatingPl: number
  currency: string
  takenAt: string
}

export function dbSaveAccountSnapshot(snap: Omit<AccountSnapshot, 'id'>): void {
  db.prepare(`
    INSERT INTO account_snapshots (login, balance, equity, margin, free_margin, floating_pl, currency, taken_at)
    VALUES (@login, @balance, @equity, @margin, @freeMargin, @floatingPl, @currency, @takenAt)
  `).run(snap)
}

export function dbGetAccountSnapshots(login: number, since?: string, limit = 500): AccountSnapshot[] {
  const q = since
    ? 'SELECT * FROM account_snapshots WHERE login = ? AND taken_at >= ? ORDER BY taken_at ASC LIMIT ?'
    : 'SELECT * FROM account_snapshots WHERE login = ? ORDER BY taken_at ASC LIMIT ?'
  const rows = (since
    ? db.prepare(q).all(login, since, limit)
    : db.prepare(q).all(login, limit)) as Array<Record<string, unknown>>
  return rows.map(r => ({
    id:         r.id as number,
    login:      r.login as number,
    balance:    r.balance as number,
    equity:     r.equity as number,
    margin:     r.margin as number,
    freeMargin: r.free_margin as number,
    floatingPl: r.floating_pl as number,
    currency:   r.currency as string,
    takenAt:    r.taken_at as string,
  }))
}

export function dbGetLatestSnapshot(login: number): AccountSnapshot | null {
  const r = db.prepare(
    'SELECT * FROM account_snapshots WHERE login = ? ORDER BY taken_at DESC LIMIT 1'
  ).get(login) as Record<string, unknown> | undefined
  if (!r) return null
  return {
    id: r.id as number, login: r.login as number, balance: r.balance as number,
    equity: r.equity as number, margin: r.margin as number, freeMargin: r.free_margin as number,
    floatingPl: r.floating_pl as number, currency: r.currency as string, takenAt: r.taken_at as string,
  }
}

// ── Challenge Configs ─────────────────────────────────────────────────────────

export interface ChallengeConfig {
  id: number
  login: number
  preset: string
  startBalance: number
  profitTargetPct: number
  dailyLossLimitPct: number
  maxDrawdownPct: number
  minTradingDays: number
  startDate: string
  active: boolean
  createdAt: string
}

function rowToChallenge(r: Record<string, unknown>): ChallengeConfig {
  return {
    id: r.id as number, login: r.login as number, preset: r.preset as string,
    startBalance: r.start_balance as number, profitTargetPct: r.profit_target_pct as number,
    dailyLossLimitPct: r.daily_loss_limit_pct as number, maxDrawdownPct: r.max_drawdown_pct as number,
    minTradingDays: r.min_trading_days as number, startDate: r.start_date as string,
    active: (r.active as number) === 1, createdAt: r.created_at as string,
  }
}

export function dbGetChallenge(login: number): ChallengeConfig | null {
  const r = db.prepare('SELECT * FROM challenge_configs WHERE login = ? AND active = 1 LIMIT 1').get(login) as Record<string, unknown> | undefined
  return r ? rowToChallenge(r) : null
}

export function dbSaveChallenge(cfg: Omit<ChallengeConfig, 'id' | 'createdAt'>): number {
  // Deactivate any existing for this login
  db.prepare('UPDATE challenge_configs SET active = 0 WHERE login = ?').run(cfg.login)
  const info = db.prepare(`
    INSERT INTO challenge_configs (login, preset, start_balance, profit_target_pct, daily_loss_limit_pct, max_drawdown_pct, min_trading_days, start_date, active)
    VALUES (@login, @preset, @startBalance, @profitTargetPct, @dailyLossLimitPct, @maxDrawdownPct, @minTradingDays, @startDate, @active)
  `).run({
    login: cfg.login, preset: cfg.preset, startBalance: cfg.startBalance,
    profitTargetPct: cfg.profitTargetPct, dailyLossLimitPct: cfg.dailyLossLimitPct,
    maxDrawdownPct: cfg.maxDrawdownPct, minTradingDays: cfg.minTradingDays,
    startDate: cfg.startDate, active: cfg.active ? 1 : 0,
  })
  return info.lastInsertRowid as number
}

export function dbDeleteChallenge(login: number): void {
  db.prepare('DELETE FROM challenge_configs WHERE login = ?').run(login)
}

// ── Account Deletion (cascade) ────────────────────────────────────────────────

export function dbDeleteMt5Account(login: number): { deleted: string[] } {
  const deleted: string[] = []
  const accountId = `mt5-${login}`

  // Delete snapshots
  const s1 = db.prepare('DELETE FROM account_snapshots WHERE login = ?').run(login)
  if (s1.changes > 0) deleted.push(`account_snapshots: ${s1.changes}`)

  // Delete challenge config
  const s2 = db.prepare('DELETE FROM challenge_configs WHERE login = ?').run(login)
  if (s2.changes > 0) deleted.push(`challenge_configs: ${s2.changes}`)

  // Delete the mt5_accounts row
  const s3 = db.prepare('DELETE FROM mt5_accounts WHERE login = ?').run(login)
  if (s3.changes > 0) deleted.push(`mt5_accounts: ${s3.changes}`)

  return { deleted }
}

// ── Data Export Queries ───────────────────────────────────────────────────────

export function dbExportAnalyses(opts: { symbolKey?: string; from?: string; to?: string; limit?: number }): Record<string, unknown>[] {
  let q = 'SELECT * FROM analyses WHERE 1=1'
  const params: unknown[] = []
  if (opts.symbolKey) { q += ' AND symbol_key = ?'; params.push(opts.symbolKey) }
  if (opts.from) { q += ' AND time >= ?'; params.push(opts.from) }
  if (opts.to) { q += ' AND time <= ?'; params.push(opts.to) }
  q += ' ORDER BY time DESC'
  if (opts.limit) { q += ' LIMIT ?'; params.push(opts.limit) }
  return db.prepare(q).all(...params) as Record<string, unknown>[]
}

export function dbExportOutcomes(opts: { symbolKey?: string; from?: string; to?: string; status?: string }): Record<string, unknown>[] {
  let q = 'SELECT * FROM proposal_outcomes WHERE 1=1'
  const params: unknown[] = []
  if (opts.symbolKey) { q += ' AND symbol_key = ?'; params.push(opts.symbolKey) }
  if (opts.from) { q += ' AND created_at >= ?'; params.push(opts.from) }
  if (opts.to) { q += ' AND created_at <= ?'; params.push(opts.to) }
  if (opts.status) { q += ' AND status = ?'; params.push(opts.status) }
  q += ' ORDER BY created_at DESC'
  return db.prepare(q).all(...params) as Record<string, unknown>[]
}

export function dbExportMemories(opts: { category?: string; active?: boolean }): Record<string, unknown>[] {
  let q = 'SELECT * FROM agent_memories WHERE 1=1'
  const params: unknown[] = []
  if (opts.category) { q += ' AND category = ?'; params.push(opts.category) }
  if (opts.active !== undefined) { q += ' AND active = ?'; params.push(opts.active ? 1 : 0) }
  q += ' ORDER BY created_at DESC'
  return db.prepare(q).all(...params) as Record<string, unknown>[]
}

export function dbExportSnapshots(opts: { login?: number; from?: string; to?: string }): Record<string, unknown>[] {
  let q = 'SELECT * FROM account_snapshots WHERE 1=1'
  const params: unknown[] = []
  if (opts.login) { q += ' AND login = ?'; params.push(opts.login) }
  if (opts.from) { q += ' AND taken_at >= ?'; params.push(opts.from) }
  if (opts.to) { q += ' AND taken_at <= ?'; params.push(opts.to) }
  q += ' ORDER BY taken_at DESC'
  return db.prepare(q).all(...params) as Record<string, unknown>[]
}

// ── Performance Analytics Queries ─────────────────────────────────────────────

export interface PerformanceStats {
  total: number
  entered: number
  wins: number
  losses: number
  expired: number
  winRate: number
  avgPipsWin: number
  avgPipsLoss: number
  totalPips: number
  expectancy: number
  profitFactor: number
  maxConsecutiveLosses: number
  bestTrade: number
  worstTrade: number
}

export function dbGetPerformanceStats(opts: { symbolKey?: string; strategyKey?: string; from?: string; to?: string }): PerformanceStats {
  let q = `SELECT o.*, a.strategy_key FROM proposal_outcomes o LEFT JOIN analyses a ON o.analysis_id = a.id WHERE 1=1`
  const params: unknown[] = []
  if (opts.symbolKey) { q += ' AND o.symbol_key = ?'; params.push(opts.symbolKey) }
  if (opts.strategyKey) { q += ' AND a.strategy_key = ?'; params.push(opts.strategyKey) }
  if (opts.from) { q += ' AND o.created_at >= ?'; params.push(opts.from) }
  if (opts.to) { q += ' AND o.created_at <= ?'; params.push(opts.to) }
  q += ' ORDER BY o.created_at ASC'

  const rows = db.prepare(q).all(...params) as Array<Record<string, unknown>>

  let entered = 0, wins = 0, losses = 0, expired = 0
  let totalPipsWin = 0, totalPipsLoss = 0
  let bestTrade = 0, worstTrade = 0
  let consecutiveLosses = 0, maxConsecutiveLosses = 0

  for (const r of rows) {
    const status = r.status as string
    const pips = (r.pips_result as number | null) ?? 0

    if (status === 'entered' || status === 'hit_tp1' || status === 'hit_tp2' || status === 'hit_sl') entered++
    if (status === 'hit_tp1' || status === 'hit_tp2') {
      wins++
      totalPipsWin += pips
      consecutiveLosses = 0
    } else if (status === 'hit_sl') {
      losses++
      totalPipsLoss += Math.abs(pips)
      consecutiveLosses++
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses)
    } else if (status === 'expired' || status === 'invalidated') {
      expired++
    }
    if (pips > bestTrade) bestTrade = pips
    if (pips < worstTrade) worstTrade = pips
  }

  const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0
  const avgPipsWin = wins > 0 ? totalPipsWin / wins : 0
  const avgPipsLoss = losses > 0 ? totalPipsLoss / losses : 0
  const expectancy = (wins + losses) > 0 ? (winRate / 100 * avgPipsWin) - ((1 - winRate / 100) * avgPipsLoss) : 0
  const profitFactor = totalPipsLoss > 0 ? totalPipsWin / totalPipsLoss : totalPipsWin > 0 ? Infinity : 0

  return {
    total: rows.length, entered, wins, losses, expired, winRate,
    avgPipsWin, avgPipsLoss, totalPips: totalPipsWin - totalPipsLoss,
    expectancy, profitFactor, maxConsecutiveLosses, bestTrade, worstTrade,
  }
}

export function dbGetPerformanceBySymbol(opts: { from?: string; to?: string }): Array<{ symbolKey: string } & PerformanceStats> {
  const symbols = db.prepare('SELECT DISTINCT symbol_key FROM proposal_outcomes').all() as Array<{ symbol_key: string }>
  return symbols.map(s => ({
    symbolKey: s.symbol_key,
    ...dbGetPerformanceStats({ symbolKey: s.symbol_key, ...opts }),
  }))
}

export function dbGetPerformanceByStrategy(opts: { from?: string; to?: string }): Array<{ strategyKey: string } & PerformanceStats> {
  const strategies = db.prepare(
    'SELECT DISTINCT a.strategy_key FROM proposal_outcomes o JOIN analyses a ON o.analysis_id = a.id WHERE a.strategy_key IS NOT NULL'
  ).all() as Array<{ strategy_key: string }>
  return strategies.map(s => ({
    strategyKey: s.strategy_key,
    ...dbGetPerformanceStats({ strategyKey: s.strategy_key, ...opts }),
  }))
}

export function dbGetPerformanceByDay(opts: { symbolKey?: string; from?: string; to?: string }): Array<{ day: string; wins: number; losses: number; pips: number }> {
  let q = `SELECT date(o.created_at) as day, o.status, o.pips_result
    FROM proposal_outcomes o WHERE (o.status = 'hit_tp1' OR o.status = 'hit_tp2' OR o.status = 'hit_sl')`
  const params: unknown[] = []
  if (opts.symbolKey) { q += ' AND o.symbol_key = ?'; params.push(opts.symbolKey) }
  if (opts.from) { q += ' AND o.created_at >= ?'; params.push(opts.from) }
  if (opts.to) { q += ' AND o.created_at <= ?'; params.push(opts.to) }
  q += ' ORDER BY day ASC'

  const rows = db.prepare(q).all(...params) as Array<{ day: string; status: string; pips_result: number | null }>
  const map = new Map<string, { wins: number; losses: number; pips: number }>()
  for (const r of rows) {
    const d = map.get(r.day) ?? { wins: 0, losses: 0, pips: 0 }
    if (r.status === 'hit_tp1' || r.status === 'hit_tp2') d.wins++
    else d.losses++
    d.pips += r.pips_result ?? 0
    map.set(r.day, d)
  }
  return [...map.entries()].map(([day, v]) => ({ day, ...v }))
}
