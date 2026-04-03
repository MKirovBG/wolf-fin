// Wolf-Fin — Versioned DB migration runner (Phase 6)
//
// Each migration is numbered, idempotent, and runs exactly once.
// Applied versions are tracked in `schema_migrations`.

import Database from 'better-sqlite3'

interface Migration {
  version: number
  name: string
  run: (db: Database.Database) => void
}

// ── Migration definitions ──────────────────────────────────────────────────────

const MIGRATIONS: Migration[] = [

  {
    version: 1,
    name: 'core_tables',
    run: (db) => db.exec(`
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
    `),
  },

  {
    version: 2,
    name: 'analyses_extra_columns',
    run: (db) => {
      const cols = new Set((db.prepare('PRAGMA table_info(analyses)').all() as Array<{ name: string }>).map(c => c.name))
      if (!cols.has('raw_response')) db.exec(`ALTER TABLE analyses ADD COLUMN raw_response TEXT`)
      if (!cols.has('llm_thinking')) db.exec(`ALTER TABLE analyses ADD COLUMN llm_thinking TEXT`)
      if (!cols.has('patterns'))     db.exec(`ALTER TABLE analyses ADD COLUMN patterns TEXT`)
      if (!cols.has('validation'))   db.exec(`ALTER TABLE analyses ADD COLUMN validation TEXT`)
    },
  },

  {
    version: 3,
    name: 'watch_symbols_extra_columns',
    run: (db) => {
      const cols = new Set((db.prepare('PRAGMA table_info(watch_symbols)').all() as Array<{ name: string }>).map(c => c.name))
      if (!cols.has('system_prompt')) db.exec(`ALTER TABLE watch_symbols ADD COLUMN system_prompt TEXT`)
      if (!cols.has('strategy'))      db.exec(`ALTER TABLE watch_symbols ADD COLUMN strategy TEXT`)
    },
  },

  {
    version: 4,
    name: 'log_entries_rename_agent_key',
    run: (db) => {
      const cols = (db.prepare('PRAGMA table_info(log_entries)').all() as Array<{ name: string }>)
      const hasAgentKey  = cols.some(c => c.name === 'agent_key')
      const hasSymbolKey = cols.some(c => c.name === 'symbol_key')
      if (hasAgentKey && !hasSymbolKey) {
        db.exec(`ALTER TABLE log_entries ADD COLUMN symbol_key TEXT NOT NULL DEFAULT ''`)
        db.exec(`UPDATE log_entries SET symbol_key = agent_key`)
      }
      if (hasAgentKey) {
        db.exec(`ALTER TABLE log_entries DROP COLUMN agent_key`)
      }
    },
  },

  {
    version: 5,
    name: 'core_indexes',
    run: (db) => db.exec(`
      CREATE INDEX IF NOT EXISTS idx_analyses_symbol_key  ON analyses(symbol_key, time DESC);
      CREATE INDEX IF NOT EXISTS idx_log_entries_symbol_key ON log_entries(symbol_key, id DESC);
    `),
  },

  {
    version: 6,
    name: 'proposal_outcomes',
    run: (db) => db.exec(`
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
      );
      CREATE INDEX IF NOT EXISTS idx_outcomes_symbol_key ON proposal_outcomes(symbol_key);
      CREATE INDEX IF NOT EXISTS idx_outcomes_status ON proposal_outcomes(status);
    `),
  },

  {
    version: 7,
    name: 'analysis_features_and_market_states',
    run: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_features (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        analysis_id INTEGER NOT NULL,
        symbol_key  TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        data        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_features_analysis_id ON analysis_features(analysis_id);
      CREATE INDEX IF NOT EXISTS idx_features_symbol_key  ON analysis_features(symbol_key, captured_at DESC);

      CREATE TABLE IF NOT EXISTS market_states (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        analysis_id        INTEGER NOT NULL,
        symbol_key         TEXT NOT NULL,
        captured_at        TEXT NOT NULL,
        regime             TEXT NOT NULL,
        direction          TEXT NOT NULL,
        direction_strength INTEGER NOT NULL,
        volatility         TEXT NOT NULL,
        session_quality    TEXT NOT NULL,
        context_risk       TEXT NOT NULL,
        data               TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_states_analysis_id ON market_states(analysis_id);
      CREATE INDEX IF NOT EXISTS idx_states_symbol_key  ON market_states(symbol_key, captured_at DESC);
    `),
  },

  {
    version: 8,
    name: 'setup_candidates',
    run: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS setup_candidates (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        analysis_id INTEGER NOT NULL,
        symbol_key  TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        detector    TEXT NOT NULL,
        direction   TEXT,
        found       INTEGER NOT NULL DEFAULT 0,
        score       INTEGER NOT NULL DEFAULT 0,
        tier        TEXT NOT NULL DEFAULT 'rejected',
        data        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_setups_analysis_id ON setup_candidates(analysis_id);
      CREATE INDEX IF NOT EXISTS idx_setups_symbol_key  ON setup_candidates(symbol_key, captured_at DESC);
    `),
  },

  {
    version: 9,
    name: 'strategies_table_and_seed',
    run: (db) => {
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
      const count = (db.prepare('SELECT COUNT(*) as n FROM strategies').get() as { n: number }).n
      if (count === 0) {
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
    },
  },

  {
    version: 10,
    name: 'strategy_versions',
    run: (db) => {
      const cols = (db.prepare('PRAGMA table_info(strategies)').all() as Array<{ name: string }>)
      if (!cols.some(c => c.name === 'definition')) {
        db.exec(`ALTER TABLE strategies ADD COLUMN definition TEXT`)
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS strategy_versions (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          strategy_key TEXT NOT NULL,
          version      TEXT NOT NULL,
          definition   TEXT NOT NULL,
          created_at   TEXT NOT NULL DEFAULT (datetime('now')),
          notes        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_strat_versions_key ON strategy_versions(strategy_key, created_at DESC);
      `)
    },
  },

  {
    version: 11,
    name: 'backtest_tables',
    run: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS backtest_runs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol_key   TEXT NOT NULL,
        config       TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'running',
        started_at   TEXT NOT NULL,
        completed_at TEXT,
        error        TEXT,
        metrics      TEXT
      );
      CREATE TABLE IF NOT EXISTS backtest_trades (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id      INTEGER NOT NULL,
        symbol_key  TEXT NOT NULL,
        detector    TEXT NOT NULL,
        direction   TEXT NOT NULL,
        entry_bar   INTEGER NOT NULL,
        entry_time  TEXT NOT NULL,
        entry_price REAL NOT NULL,
        stop_loss   REAL NOT NULL,
        targets     TEXT NOT NULL,
        score       INTEGER NOT NULL,
        setup_type  TEXT NOT NULL,
        tags        TEXT NOT NULL,
        outcome     TEXT NOT NULL DEFAULT 'not_filled',
        exit_price  REAL,
        exit_time   TEXT,
        bars_held   INTEGER,
        r_multiple  REAL,
        mae         REAL,
        mfe         REAL
      );
      CREATE INDEX IF NOT EXISTS idx_bt_trades_run_id ON backtest_trades(run_id);
    `),
  },

  {
    version: 12,
    name: 'alert_tables',
    run: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS alert_rules (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol_key      TEXT NOT NULL,
        name            TEXT NOT NULL,
        condition_type  TEXT NOT NULL,
        condition_value TEXT NOT NULL,
        enabled         INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS alert_firings (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id      INTEGER NOT NULL,
        symbol_key   TEXT NOT NULL,
        analysis_id  INTEGER,
        fired_at     TEXT NOT NULL,
        message      TEXT NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_alert_firings_rule ON alert_firings(rule_id, fired_at DESC);
    `),
  },

  {
    version: 13,
    name: 'symbol_strategies',
    run: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS symbol_strategies (
        symbol_key   TEXT NOT NULL,
        strategy_key TEXT NOT NULL,
        enabled      INTEGER NOT NULL DEFAULT 1,
        added_at     TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (symbol_key, strategy_key)
      );
      CREATE INDEX IF NOT EXISTS idx_symbol_strategies_symbol ON symbol_strategies(symbol_key);
    `),
  },

  {
    version: 14,
    name: 'analyses_strategy_key',
    run: (db) => {
      const cols = new Set((db.prepare('PRAGMA table_info(analyses)').all() as Array<{ name: string }>).map(c => c.name))
      if (!cols.has('strategy_key')) db.exec(`ALTER TABLE analyses ADD COLUMN strategy_key TEXT`)
    },
  },

  {
    version: 15,
    name: 'analyses_reasoning_chain',
    run: (db) => {
      const cols = new Set((db.prepare('PRAGMA table_info(analyses)').all() as Array<{ name: string }>).map(c => c.name))
      if (!cols.has('reasoning_chain')) db.exec(`ALTER TABLE analyses ADD COLUMN reasoning_chain TEXT`)
    },
  },

  {
    version: 16,
    name: 'analysis_feedback',
    run: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_feedback (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        analysis_id INTEGER NOT NULL,
        rating      INTEGER,
        comment     TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_feedback_analysis ON analysis_feedback(analysis_id);
    `),
  },

  {
    version: 17,
    name: 'agent_memories',
    run: (db) => db.exec(`
      DROP TABLE IF EXISTS agent_memories;
      CREATE TABLE IF NOT EXISTS agent_memories (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol            TEXT,
        category          TEXT NOT NULL,
        content           TEXT NOT NULL,
        confidence        REAL NOT NULL DEFAULT 0.5,
        source_analysis_id INTEGER,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at        TEXT,
        active            INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_memories_symbol ON agent_memories(symbol, active);
      CREATE INDEX IF NOT EXISTS idx_memories_category ON agent_memories(category, active);
    `),
  },

  {
    version: 18,
    name: 'agent_rules',
    run: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS agent_rules (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_text   TEXT NOT NULL,
        scope       TEXT NOT NULL DEFAULT 'global',
        scope_value TEXT,
        priority    INTEGER NOT NULL DEFAULT 0,
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `),
  },

  {
    version: 19,
    name: 'analyses_system_prompt',
    run: (db) => db.exec(`
      ALTER TABLE analyses ADD COLUMN system_prompt TEXT;
    `),
  },

  {
    version: 20,
    name: 'account_snapshots',
    run: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS account_snapshots (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        login       INTEGER NOT NULL,
        balance     REAL NOT NULL,
        equity      REAL NOT NULL,
        margin      REAL NOT NULL DEFAULT 0,
        free_margin REAL NOT NULL DEFAULT 0,
        floating_pl REAL NOT NULL DEFAULT 0,
        currency    TEXT NOT NULL DEFAULT 'USD',
        taken_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_login_time ON account_snapshots(login, taken_at);
    `),
  },

  {
    version: 21,
    name: 'challenge_configs',
    run: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS challenge_configs (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        login               INTEGER NOT NULL UNIQUE,
        preset              TEXT NOT NULL DEFAULT 'custom',
        start_balance       REAL NOT NULL,
        profit_target_pct   REAL NOT NULL DEFAULT 10,
        daily_loss_limit_pct REAL NOT NULL DEFAULT 5,
        max_drawdown_pct    REAL NOT NULL DEFAULT 10,
        min_trading_days    INTEGER NOT NULL DEFAULT 0,
        start_date          TEXT NOT NULL DEFAULT (datetime('now')),
        active              INTEGER NOT NULL DEFAULT 1,
        created_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `),
  },

  {
    version: 22,
    name: 'symbol_notify_mode',
    run: (db) => db.exec(`
      ALTER TABLE watch_symbols ADD COLUMN notify_mode TEXT DEFAULT 'all';
    `),
  },

]

// ── Runner ─────────────────────────────────────────────────────────────────────

/**
 * Creates the schema_migrations tracking table (if needed), then runs any
 * migrations whose version number is not yet recorded.
 * Returns the list of migration names that were applied.
 */
export function runMigrations(db: Database.Database): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>)
      .map(r => r.version)
  )

  const stamp = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
  const ran: string[] = []

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    m.run(db)
    stamp.run(m.version, m.name)
    ran.push(`${m.version}:${m.name}`)
  }

  return ran
}

/** Returns a snapshot of all applied migrations (for the health endpoint). */
export function getMigrationStatus(db: Database.Database): Array<{ version: number; name: string; appliedAt: string }> {
  return (db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC').all() as Array<{ version: number; name: string; applied_at: string }>)
    .map(r => ({ version: r.version, name: r.name, appliedAt: r.applied_at }))
}
