# Wolf-Fin — Database Documentation

**Engine:** SQLite via `better-sqlite3` (synchronous API)
**File:** `data/wolf-fin.db`
**Journal mode:** WAL (Write-Ahead Logging)
**Busy timeout:** 5000ms

The schema is managed by a versioned migration runner (`src/db/migrations.ts`). Migrations run on startup, are idempotent, and are tracked in the `schema_migrations` table.

---

## Tables

### `schema_migrations`
Tracks applied migrations.

| Column | Type | Description |
|---|---|---|
| `version` | INTEGER PK | Migration version number |
| `name` | TEXT | Migration name |
| `applied_at` | TEXT | ISO timestamp |

### `watch_symbols`
Symbols being monitored for analysis.

| Column | Type | Description |
|---|---|---|
| `key` | TEXT PK | Unique key (e.g. `XAUUSD_mt5_12345`) |
| `symbol` | TEXT | MT5 symbol name |
| `market` | TEXT | Always `mt5` |
| `display_name` | TEXT | Optional display name |
| `mt5_account_id` | INTEGER | MT5 account login |
| `schedule_enabled` | INTEGER | 0/1 |
| `schedule_interval_ms` | INTEGER | Cron interval |
| `schedule_start_utc` | TEXT | Daily start time (HH:MM UTC) |
| `schedule_end_utc` | TEXT | Daily end time (HH:MM UTC) |
| `indicator_config` | TEXT | JSON: indicator toggles + periods |
| `candle_config` | TEXT | JSON: timeframe + limit |
| `context_config` | TEXT | JSON: news/calendar toggles |
| `llm_provider` | TEXT | Per-symbol LLM provider override |
| `llm_model` | TEXT | Per-symbol model override |
| `strategy` | TEXT | Strategy key |
| `system_prompt` | TEXT | Custom system prompt suffix |
| `created_at` | TEXT | ISO timestamp |
| `last_analysis_at` | TEXT | ISO timestamp |

### `analyses`
Full analysis results.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `symbol_key` | TEXT | FK → watch_symbols.key |
| `symbol` | TEXT | MT5 symbol |
| `market` | TEXT | `mt5` |
| `timeframe` | TEXT | e.g. `h1` |
| `time` | TEXT | ISO timestamp of analysis |
| `bias` | TEXT | `bullish`, `bearish`, `neutral` |
| `summary` | TEXT | LLM narrative summary |
| `key_levels` | TEXT | JSON: KeyLevel[] |
| `proposal` | TEXT | JSON: TradeProposal |
| `indicators` | TEXT | JSON: computed indicator values |
| `candles` | TEXT | JSON: CandleBar[] |
| `context` | TEXT | JSON: news, calendar, price, session |
| `llm_provider` | TEXT | |
| `llm_model` | TEXT | |
| `error` | TEXT | Error message if analysis failed |
| `raw_response` | TEXT | Raw LLM text response |
| `llm_thinking` | TEXT | Extended thinking output (Anthropic) |
| `patterns` | TEXT | JSON: CandlePattern[] |
| `validation` | TEXT | JSON: ProposalValidation |

**Indexes:** `(symbol_key, time DESC)`

### `log_entries`
Structured application logs (pruned to 10,000 rows on startup).

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `time` | TEXT | ISO timestamp |
| `symbol_key` | TEXT | Associated symbol |
| `level` | TEXT | `info`, `warn`, `error`, `debug` |
| `event` | TEXT | Event type slug |
| `message` | TEXT | Human-readable message |
| `data` | TEXT | JSON: arbitrary extra data |

**Indexes:** `(symbol_key, id DESC)`

### `settings`
Key-value store for persistent settings.

| Column | Type |
|---|---|
| `key` | TEXT PK |
| `value` | TEXT |

Used for `selected_account` (JSON).

### `mt5_accounts`
Known MT5 accounts seen via the bridge.

| Column | Type | Description |
|---|---|---|
| `login` | INTEGER PK | MT5 account login number |
| `name` | TEXT | Account name |
| `server` | TEXT | Broker server |
| `mode` | TEXT | `DEMO` or `LIVE` |
| `last_seen_at` | TEXT | ISO timestamp |
| `in_bridge` | INTEGER | 0/1 — currently visible in bridge |

### `proposal_outcomes`
Trade proposal outcome tracking.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `analysis_id` | INTEGER | FK → analyses.id |
| `symbol_key` | TEXT | |
| `direction` | TEXT | `BUY` or `SELL` |
| `entry_low` | REAL | |
| `entry_high` | REAL | |
| `sl` | REAL | Stop loss |
| `tp1/tp2/tp3` | REAL | Take profit levels |
| `status` | TEXT | `pending`, `entered`, `hit_tp1`, `hit_tp2`, `hit_sl`, `expired`, `invalidated` |
| `created_at` | TEXT | |
| `entered_at` | TEXT | When price entered the zone |
| `resolved_at` | TEXT | When outcome was determined |
| `exit_price` | REAL | |
| `pips_result` | REAL | |

**Indexes:** `(symbol_key)`, `(status)`

### `analysis_features`
Feature snapshots saved alongside each analysis.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `analysis_id` | INTEGER | FK → analyses.id |
| `symbol_key` | TEXT | |
| `captured_at` | TEXT | ISO timestamp |
| `data` | TEXT | JSON: full FeatureSnapshot |

**Indexes:** `(analysis_id)`, `(symbol_key, captured_at DESC)`

### `market_states`
Market regime classifications saved per analysis.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `analysis_id` | INTEGER | FK → analyses.id |
| `symbol_key` | TEXT | |
| `captured_at` | TEXT | |
| `regime` | TEXT | `trend`, `range`, `breakout_watch`, `reversal_watch`, `volatile`, `compressed` |
| `direction` | TEXT | `bullish`, `bearish`, `neutral` |
| `direction_strength` | INTEGER | 0–100 |
| `volatility` | TEXT | `quiet`, `normal`, `elevated`, `abnormal` |
| `session_quality` | TEXT | `poor`, `acceptable`, `favorable`, `optimal` |
| `context_risk` | TEXT | `low`, `moderate`, `elevated`, `avoid` |
| `data` | TEXT | JSON: full MarketState (reasons arrays, etc.) |

**Indexes:** `(analysis_id)`, `(symbol_key, captured_at DESC)`

### `setup_candidates`
Detector outputs and scores saved per analysis.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `analysis_id` | INTEGER | FK → analyses.id |
| `symbol_key` | TEXT | |
| `captured_at` | TEXT | |
| `detector` | TEXT | `trendPullback`, `breakoutRetest`, `liquiditySweep`, `openingRange`, `rangeFade`, `sessionReversal` |
| `direction` | TEXT | `BUY`, `SELL`, or NULL |
| `found` | INTEGER | 0/1 |
| `score` | INTEGER | 0–100 |
| `tier` | TEXT | `valid`, `watchlist`, `low_quality`, `rejected` |
| `data` | TEXT | JSON: full SetupCandidate (entry zone, SL, targets, breakdown, reasons, etc.) |

**Indexes:** `(analysis_id)`, `(symbol_key, captured_at DESC)`

### `strategies`
Built-in and custom trading strategy definitions.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `key` | TEXT UNIQUE | Identifier |
| `name` | TEXT | Display name |
| `description` | TEXT | One-line description |
| `instructions` | TEXT | Text injected into LLM system prompt |
| `is_builtin` | INTEGER | 0/1 — built-ins cannot be deleted |
| `definition` | TEXT | JSON: StrategyDefinition (for backtest engine) |
| `created_at` | TEXT | |

Built-in strategies: `price_action`, `ict`, `trend`, `swing`, `scalping`, `smc`

### `strategy_versions`
Version history for strategy definitions.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `strategy_key` | TEXT | FK → strategies.key |
| `version` | TEXT | Semantic version string |
| `definition` | TEXT | JSON snapshot of definition |
| `created_at` | TEXT | |
| `notes` | TEXT | Change notes |

**Index:** `(strategy_key, created_at DESC)`

### `backtest_runs`
Backtest execution records.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `symbol_key` | TEXT | |
| `config` | TEXT | JSON: BacktestConfig |
| `status` | TEXT | `running`, `complete`, `failed` |
| `started_at` | TEXT | |
| `completed_at` | TEXT | |
| `error` | TEXT | Error message if failed |
| `metrics` | TEXT | JSON: BacktestMetrics (win rate, avg R:R, etc.) |

### `backtest_trades`
Individual trade records from backtest runs.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `run_id` | INTEGER | FK → backtest_runs.id |
| `symbol_key` | TEXT | |
| `bar_index` | INTEGER | Entry bar |
| `direction` | TEXT | `BUY` or `SELL` |
| `entry_price` | REAL | |
| `sl` | REAL | |
| `tp1` | REAL | |
| `exit_price` | REAL | |
| `exit_reason` | TEXT | `tp1`, `sl`, `end_of_data` |
| `pips` | REAL | |
| `rr_achieved` | REAL | |

### `alert_rules`
User-defined alert conditions.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `symbol_key` | TEXT | |
| `name` | TEXT | Display name |
| `condition_type` | TEXT | `setup_score_gte`, `regime_change`, `direction_change`, `context_risk_gte` |
| `condition_value` | TEXT | Threshold or target value |
| `enabled` | INTEGER | 0/1 |
| `created_at` | TEXT | |

### `alert_firings`
History of alert rule evaluations that triggered.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `rule_id` | INTEGER | FK → alert_rules.id |
| `symbol_key` | TEXT | |
| `analysis_id` | INTEGER | Analysis that triggered the firing |
| `fired_at` | TEXT | ISO timestamp |
| `message` | TEXT | Human-readable firing description |
| `acknowledged` | INTEGER | 0/1 |

---

## Migration Versions

| Version | Name | Description |
|---|---|---|
| 1 | `core_tables` | watch_symbols, analyses, log_entries, settings, mt5_accounts |
| 2 | `analyses_extra_columns` | raw_response, llm_thinking, patterns, validation |
| 3 | `watch_symbols_extra_columns` | system_prompt, strategy |
| 4 | `log_entries_rename_agent_key` | rename agent_key → symbol_key |
| 5 | `core_indexes` | Performance indexes on analyses + log_entries |
| 6 | `proposal_outcomes` | proposal_outcomes table |
| 7 | `analysis_features_and_market_states` | analysis_features, market_states |
| 8 | `setup_candidates` | setup_candidates table |
| 9 | `strategies_table_and_seed` | strategies table + 6 built-in seeds |
| 10 | `strategy_versions` | strategy definition column + strategy_versions table |
| 11 | `backtest_tables` | backtest_runs, backtest_trades |
| 12 | `alert_tables` | alert_rules, alert_firings |
