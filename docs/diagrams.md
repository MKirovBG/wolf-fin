# Wolf-Fin — Architecture Diagrams

Copy each code block into an Eraser diagram (eraser.io). Set the diagram type as indicated.

---

## 1. System Architecture (Flowchart)

**Diagram type:** Flowchart

```
flowchart TD
  MT5[MetaTrader5 Terminal] -->|MT5 Python API| Bridge[mt5-bridge\nPython FastAPI :8000]
  Bridge -->|HTTP REST| Adapter[MT5Adapter\nsrc/adapters/mt5.ts]
  Finnhub[Finnhub API] -->|REST| Calendar[calendar.ts]
  
  Adapter --> Analyzer[runAnalysis\nsrc/analyzer/index.ts]
  Calendar --> Analyzer

  Analyzer --> Features[computeFeatures\nsrc/engine/]
  Features --> MarketState[classifyMarketState\nsrc/market/]
  MarketState --> Detectors[6 Detectors\nsrc/detectors/]
  Detectors --> Scoring[Scoring Engine\nsrc/scoring/]
  Scoring --> LLM[LLM Provider\nAnthropic / OpenRouter\nOllama / OpenAI]
  LLM --> Result[AnalysisResult]
  Result --> DB[(SQLite\ndata/wolf-fin.db)]
  Result --> SSE[SSE Broadcast\n/api/analyses/stream]
  
  DB --> Server[Fastify Server\nsrc/server/index.ts :3000]
  Server -->|Static + API| Frontend[React Frontend\nVite :5173 dev]
  SSE --> Frontend
```

---

## 2. Analysis Pipeline (Sequence Diagram)

**Diagram type:** Sequence

```
sequence
  Dashboard -> Server: POST /api/symbols/:key/analyze
  Server -> Analyzer: runAnalysis(key)
  Analyzer -> MT5Bridge: GET /candles/XAUUSD?timeframe=H1&count=200
  MT5Bridge -> MT5: copy_rates_from_pos
  MT5Bridge --> Analyzer: { candles: [...] }
  Analyzer -> Finnhub: GET news + calendar
  Finnhub --> Analyzer: { news, events }
  Analyzer -> FeatureEngine: computeFeatures(candles, config)
  FeatureEngine --> Analyzer: FeatureSnapshot (40+ indicators)
  Analyzer -> MarketClassifier: classifyMarketState(features, context)
  MarketClassifier --> Analyzer: MarketState (regime, direction, risk)
  Analyzer -> Detectors: run 6 detectors in parallel
  Detectors --> Analyzer: SetupCandidate[] (6 results)
  Analyzer -> ScoringEngine: score each candidate (9 components)
  ScoringEngine --> Analyzer: scored + tiered candidates
  Analyzer -> LLM: buildPrompt(topCandidate, context, strategy)
  LLM --> Analyzer: AnalysisResult JSON
  Analyzer -> DB: persist features, state, candidates, analysis
  Analyzer -> AlertEngine: evaluate alert rules
  Analyzer --> Server: AnalysisResult
  Server -> SSE: broadcast { symbolKey, analysisId }
  SSE --> Dashboard: event → reload analysis
```

---

## 3. Database Schema (ER Diagram)

**Diagram type:** Entity Relationship

```
erDiagram
  watch_symbols {
    text key PK
    text symbol
    text market
    integer mt5_account_id
    integer schedule_enabled
    text indicator_config
    text candle_config
    text llm_provider
    text strategy
  }

  analyses {
    integer id PK
    text symbol_key FK
    text time
    text bias
    text summary
    text proposal
    text indicators
    text candles
    text llm_provider
    text error
  }

  analysis_features {
    integer id PK
    integer analysis_id FK
    text symbol_key
    text data
  }

  market_states {
    integer id PK
    integer analysis_id FK
    text symbol_key
    text regime
    text direction
    integer direction_strength
    text volatility
    text session_quality
    text context_risk
    text data
  }

  setup_candidates {
    integer id PK
    integer analysis_id FK
    text symbol_key
    text detector
    integer found
    integer score
    text tier
    text data
  }

  strategies {
    integer id PK
    text key
    text name
    text instructions
    integer is_builtin
  }

  backtest_runs {
    integer id PK
    text symbol_key
    text config
    text status
    text metrics
  }

  backtest_trades {
    integer id PK
    integer run_id FK
    text direction
    real entry_price
    real pips
  }

  alert_rules {
    integer id PK
    text symbol_key
    text condition_type
    text condition_value
    integer enabled
  }

  alert_firings {
    integer id PK
    integer rule_id FK
    text symbol_key
    integer analysis_id
    integer acknowledged
  }

  proposal_outcomes {
    integer id PK
    integer analysis_id FK
    text symbol_key
    text status
    real pips_result
  }

  watch_symbols ||--o{ analyses : "has"
  analyses ||--|| analysis_features : "has"
  analyses ||--|| market_states : "has"
  analyses ||--o{ setup_candidates : "has"
  analyses ||--o{ proposal_outcomes : "has"
  backtest_runs ||--o{ backtest_trades : "has"
  alert_rules ||--o{ alert_firings : "has"
```

---

## 4. Frontend Page Structure (Flowchart)

**Diagram type:** Flowchart

```
flowchart TD
  App --> Dashboard
  App --> SymbolDetail
  App --> Strategies
  App --> Settings
  App --> Logs
  App --> Calendar

  Dashboard --> SymbolGrid[Symbol Grid\nbias + direction + R:R per symbol]
  SymbolGrid -->|click| SymbolDetail

  SymbolDetail --> AnalysisTab[Analysis Tab\nchart + LLM proposal + history]
  SymbolDetail --> SetupsTab[Setups Tab\n6 detector cards + score breakdown]
  SymbolDetail --> MarketStateTab[Market State Tab\nregime + direction + risk]
  SymbolDetail --> AlertsTab[Alerts Tab\nrules CRUD + firings]

  Strategies --> BuiltinList[Built-in Strategies\n6 pre-seeded]
  Strategies --> CustomList[Custom Strategies\nCRUD]

  Settings --> LLMConfig[LLM Provider/Model]
  Settings --> KeysConfig[API Keys]
  Settings --> BridgeConfig[MT5 Bridge Config]
```

---

## 5. Setup Detection & Scoring (Flowchart)

**Diagram type:** Flowchart

```
flowchart LR
  Features[FeatureSnapshot] --> D1[trendPullback]
  Features --> D2[breakoutRetest]
  Features --> D3[liquiditySweep]
  Features --> D4[openingRange]
  Features --> D5[rangeFade]
  Features --> D6[sessionReversal]

  D1 --> Score1[Score 0-100]
  D2 --> Score2[Score 0-100]
  D3 --> Score3[Score 0-100]
  D4 --> Score4[Score 0-100]
  D5 --> Score5[Score 0-100]
  D6 --> Score6[Score 0-100]

  Score1 --> Tier{Tier}
  Score2 --> Tier
  Score3 --> Tier
  Score4 --> Tier
  Score5 --> Tier
  Score6 --> Tier

  Tier -->|score >= 65| Valid[valid]
  Tier -->|score 45-64| Watchlist[watchlist]
  Tier -->|score 25-44| LowQuality[low_quality]
  Tier -->|score < 25| Rejected[rejected]

  Valid --> TopCandidate[Top Candidate → LLM Prompt]
  Watchlist --> Store[(DB: setup_candidates)]
  LowQuality --> Store
  Rejected --> Store
  TopCandidate --> Store
```
