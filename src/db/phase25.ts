// Wolf-Fin — Phase 2–5 DB helpers
// Imported by db/index.ts re-exports and by server routes directly.

import Database from 'better-sqlite3'
import type { SetupCandidate } from '../types/setup.js'
import type { AlertRule, AlertFiring, BacktestTrade } from '../types/research.js'

// Reference to the shared db instance — set by initPhase25()
let db: Database.Database

export function initPhase25(dbInstance: Database.Database): void {
  db = dbInstance
}

// ── Phase 2: Setup candidates ─────────────────────────────────────────────────

export function dbSaveCandidates(candidates: SetupCandidate[], analysisId: number): void {
  const stmt = db.prepare(`
    INSERT INTO setup_candidates (analysis_id, symbol_key, captured_at, detector, direction, found, score, tier, data)
    VALUES (@analysisId, @symbolKey, @capturedAt, @detector, @direction, @found, @score, @tier, @data)
  `)
  for (const c of candidates) {
    stmt.run({
      analysisId,
      symbolKey:  c.symbolKey,
      capturedAt: c.capturedAt,
      detector:   c.detector,
      direction:  c.direction ?? null,
      found:      c.found ? 1 : 0,
      score:      c.score,
      tier:       c.tier,
      data:       JSON.stringify({ ...c, analysisId }),
    })
  }
}

export function dbGetCandidatesForAnalysis(analysisId: number): SetupCandidate[] {
  const rows = db.prepare(
    'SELECT data FROM setup_candidates WHERE analysis_id = ? ORDER BY score DESC'
  ).all(analysisId) as { data: string }[]
  return rows.map(r => JSON.parse(r.data) as SetupCandidate)
}

export function dbGetLatestCandidates(symbolKey: string): SetupCandidate[] {
  const latest = db.prepare(
    'SELECT analysis_id FROM setup_candidates WHERE symbol_key = ? ORDER BY captured_at DESC LIMIT 1'
  ).get(symbolKey) as { analysis_id: number } | undefined
  if (!latest) return []
  return dbGetCandidatesForAnalysis(latest.analysis_id)
}

// ── Phase 3: Strategy versioning ──────────────────────────────────────────────

export function dbSaveStrategyVersion(strategyKey: string, version: string, definition: object, notes?: string): void {
  db.prepare(`
    INSERT INTO strategy_versions (strategy_key, version, definition, notes)
    VALUES (@strategyKey, @version, @definition, @notes)
  `).run({ strategyKey, version, definition: JSON.stringify(definition), notes: notes ?? null })
}

export function dbGetStrategyVersions(strategyKey: string): Array<{ id: number; version: string; createdAt: string; notes: string | null }> {
  const rows = db.prepare(
    'SELECT id, version, created_at, notes FROM strategy_versions WHERE strategy_key = ? ORDER BY created_at DESC'
  ).all(strategyKey) as Array<{ id: number; version: string; created_at: string; notes: string | null }>
  return rows.map(r => ({ id: r.id, version: r.version, createdAt: r.created_at, notes: r.notes }))
}

export function dbUpdateStrategyDefinition(key: string, definition: object): void {
  db.prepare('UPDATE strategies SET definition = ? WHERE key = ?').run(JSON.stringify(definition), key)
}

// ── Phase 4: Backtest runs ────────────────────────────────────────────────────

export function dbCreateBacktestRun(symbolKey: string, config: object): number {
  const info = db.prepare(`
    INSERT INTO backtest_runs (symbol_key, config, status, started_at)
    VALUES (@symbolKey, @config, 'running', @startedAt)
  `).run({ symbolKey, config: JSON.stringify(config), startedAt: new Date().toISOString() })
  return info.lastInsertRowid as number
}

export function dbCompleteBacktestRun(id: number, metrics: object): void {
  db.prepare(
    "UPDATE backtest_runs SET status = 'complete', completed_at = @completedAt, metrics = @metrics WHERE id = @id"
  ).run({ id, completedAt: new Date().toISOString(), metrics: JSON.stringify(metrics) })
}

export function dbFailBacktestRun(id: number, error: string): void {
  db.prepare(
    "UPDATE backtest_runs SET status = 'failed', completed_at = @completedAt, error = @error WHERE id = @id"
  ).run({ id, completedAt: new Date().toISOString(), error })
}

export function dbGetBacktestRun(id: number): {
  id: number; symbolKey: string; config: object; status: string; startedAt: string;
  completedAt: string | null; error: string | null; metrics: object | null
} | null {
  const row = db.prepare('SELECT * FROM backtest_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id:          row.id as number,
    symbolKey:   row.symbol_key as string,
    config:      JSON.parse(row.config as string),
    status:      row.status as string,
    startedAt:   row.started_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
    error:       (row.error as string | null) ?? null,
    metrics:     row.metrics ? JSON.parse(row.metrics as string) : null,
  }
}

export function dbSaveBacktestTrades(trades: BacktestTrade[]): void {
  const stmt = db.prepare(`
    INSERT INTO backtest_trades
      (run_id, symbol_key, detector, direction, entry_bar, entry_time, entry_price,
       stop_loss, targets, score, setup_type, tags, outcome, exit_price, exit_time, bars_held, r_multiple, mae, mfe)
    VALUES
      (@runId, @symbolKey, @detector, @direction, @entryBar, @entryTime, @entryPrice,
       @stopLoss, @targets, @score, @setupType, @tags, @outcome, @exitPrice, @exitTime, @barsHeld, @rMultiple, @mae, @mfe)
  `)
  for (const t of trades) {
    stmt.run({
      runId:      t.runId,
      symbolKey:  t.symbolKey,
      detector:   t.detector,
      direction:  t.direction,
      entryBar:   t.entryBar,
      entryTime:  t.entryTime,
      entryPrice: t.entryPrice,
      stopLoss:   t.stopLoss,
      targets:    JSON.stringify(t.targets),
      score:      t.score,
      setupType:  t.setupType,
      tags:       JSON.stringify(t.tags),
      outcome:    t.outcome,
      exitPrice:  t.exitPrice ?? null,
      exitTime:   t.exitTime ?? null,
      barsHeld:   t.barsHeld ?? null,
      rMultiple:  t.rMultiple ?? null,
      mae:        t.mae ?? null,
      mfe:        t.mfe ?? null,
    })
  }
}

// ── Phase 5: Alerts ───────────────────────────────────────────────────────────

export function dbCreateAlertRule(rule: Omit<AlertRule, 'id' | 'createdAt'>): number {
  const info = db.prepare(`
    INSERT INTO alert_rules (symbol_key, name, condition_type, condition_value, enabled)
    VALUES (@symbolKey, @name, @conditionType, @conditionValue, @enabled)
  `).run({
    symbolKey:      rule.symbolKey,
    name:           rule.name,
    conditionType:  rule.conditionType,
    conditionValue: rule.conditionValue,
    enabled:        rule.enabled ? 1 : 0,
  })
  return info.lastInsertRowid as number
}

export function dbGetAlertRules(symbolKey?: string): AlertRule[] {
  const rows: Record<string, unknown>[] = symbolKey
    ? db.prepare('SELECT * FROM alert_rules WHERE symbol_key = ? ORDER BY created_at DESC').all(symbolKey) as Record<string, unknown>[]
    : db.prepare('SELECT * FROM alert_rules ORDER BY created_at DESC').all() as Record<string, unknown>[]
  return rows.map(r => ({
    id:             r.id as number,
    symbolKey:      r.symbol_key as string,
    name:           r.name as string,
    conditionType:  r.condition_type as AlertRule['conditionType'],
    conditionValue: r.condition_value as string,
    enabled:        Boolean(r.enabled),
    createdAt:      r.created_at as string,
  }))
}

export function dbToggleAlertRule(id: number, enabled: boolean): void {
  db.prepare('UPDATE alert_rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
}

export function dbDeleteAlertRule(id: number): void {
  db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id)
}

export function dbFireAlert(ruleId: number, symbolKey: string, message: string, analysisId?: number): void {
  db.prepare(`
    INSERT INTO alert_firings (rule_id, symbol_key, analysis_id, fired_at, message)
    VALUES (@ruleId, @symbolKey, @analysisId, @firedAt, @message)
  `).run({ ruleId, symbolKey, analysisId: analysisId ?? null, firedAt: new Date().toISOString(), message })
}

export function dbGetAlertFirings(symbolKey?: string, limit = 50): AlertFiring[] {
  const rows: Record<string, unknown>[] = symbolKey
    ? db.prepare('SELECT * FROM alert_firings WHERE symbol_key = ? ORDER BY fired_at DESC LIMIT ?').all(symbolKey, limit) as Record<string, unknown>[]
    : db.prepare('SELECT * FROM alert_firings ORDER BY fired_at DESC LIMIT ?').all(limit) as Record<string, unknown>[]
  return rows.map(r => ({
    id:           r.id as number,
    ruleId:       r.rule_id as number,
    symbolKey:    r.symbol_key as string,
    analysisId:   (r.analysis_id as number | null) ?? undefined,
    firedAt:      r.fired_at as string,
    message:      r.message as string,
    acknowledged: Boolean(r.acknowledged),
  }))
}

export function dbAcknowledgeAlert(id: number): void {
  db.prepare('UPDATE alert_firings SET acknowledged = 1 WHERE id = ?').run(id)
}

export function dbGetLatestFeatureHistory(symbolKey: string, limit = 100): Array<{ analysisId: number; capturedAt: string }> {
  const rows = db.prepare(
    'SELECT analysis_id, captured_at FROM analysis_features WHERE symbol_key = ? ORDER BY captured_at DESC LIMIT ?'
  ).all(symbolKey, limit) as Array<{ analysis_id: number; captured_at: string }>
  return rows.map(r => ({ analysisId: r.analysis_id, capturedAt: r.captured_at }))
}
