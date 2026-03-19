# Wolf-Fin Project Overview

## Tech Stack

- **Backend**: Node.js/TypeScript, Fastify, SQLite (better-sqlite3)
- **Frontend**: React 18, TypeScript, Tailwind CSS, Vite, react-hook-form, Recharts
- **MT5 Bridge**: Python FastAPI at 127.0.0.1:8000 (only ONE active MT5 connection at a time)
- **LLM**: Anthropic Claude SDK + OpenRouter (per-agent config: llmProvider, llmModel)
- **Scheduler**: setInterval-based, not cron

---

## Current State (as of 2026-03-18)

All changes are committed and pushed to GitHub (MKirovBG/wolf-fin, branch main).

**Latest commits (newest first):**
- `8576387` — fix: cycle thread scroll, agent page centering, reports trade history scroll
- `26beafe` — fix: rate limit emergency stop (pushed earlier session)
- `cf68b09` — feat: cycle detail modal — clickable trade history with full context
- `4a15a77` — fix: MT5 inactive accounts, log panel order, rename Integrations page
- `2370dc4` — feat: remove Alpaca, add toast notifications, fix agent save sync

---

## Completed Features

1. **Alpaca fully removed** — backend, frontend, types, API keys, accounts
2. **Toast notifications** — ToastProvider in Layout.tsx, useToast() hook, success/error on agent create/save
3. **Agent save fix** — `useEffect(() => { reset(agent.config) }, [agent.config, reset])` in AgentCard
4. **Agent cards** — simplified: info + Open button only, all editing on agent detail page
5. **MT5 inactive accounts** — /health check for activeLogin, inactive accounts show grey "Not active" instead of red 502 error
6. **Log panel reorder** — Decisions → Thinking → Tool Calls → Errors
7. **Integrations page** — renamed from "API Keys"
8. **Cycle detail modal** — clickable rows in Reports → modal with broker/agent/decision/thinking/tool calls/timeline. Backend: GET /api/cycles/:id, dbGetCycleById, dbGetLogsForCycle (±15min window)
9. **Rate limit emergency stop** — OpenRouter 429 → stops agent + closes all open MT5 positions
10. **CycleThread scrollable** — expanded sections capped at 560px, themed scrollbar
11. **Agent page centered + buttons redesigned** — compact pill buttons, mx-auto on overview content
12. **Reports trade history** — fixed-height scrollable (480px, ~15 rows visible), sticky thead, themed scrollbar

---

## Frontend Pages

| Page | Description |
|------|-------------|
| `Dashboard` | Agent overview + recent events |
| `Agents` | List of all agents |
| `AgentCreate` | Create new agent (market, symbol loaded from broker, fetchMode, interval, maxLoss, leverage, LLM, customPrompt) |
| `AgentDetail` | Tabs: Overview (stats, last decision, config editor, system prompt) + Logs (threaded cycles) |
| `Positions` | Open positions across agents |
| `Reports` | P&L chart + scrollable trade history table + CycleDetailModal |
| `Integrations` | Manage API keys (formerly "ApiKeys") |
| `Account` | Binance + MT5 account summaries |

---

## Key Frontend Components

- `CycleThread.tsx` — collapsible cycle thread with scrollable body (560px max)
- `ThreadedLogsPanel.tsx` — live polling log panel, groups logs into cycle threads
- `CycleDetailModal.tsx` — trade detail modal (fetches /api/cycles/:id)
- `Toast.tsx` — ToastProvider + useToast() hook
- `SystemPromptEditor.tsx` — read-only with locked edit mode and warning banner
- `AgentCard.tsx` / `SettingsPanel` — config editor with form reset on save

---

## Backend Key Files

| File | Role |
|------|------|
| `src/agent/index.ts` | runAgentCycle(), buildSystemPrompt(), buildCycleUserMessage(), external close detection (piggybacked on get_snapshot), rate limit handling |
| `src/adapters/mt5.ts` | MT5 bridge wrapper, per-account via accountId query param |
| `src/adapters/binance.ts` | Binance spot adapter (singleton) |
| `src/adapters/registry.ts` | getAdapter('crypto' \| 'mt5', mt5AccountId?) |
| `src/guardrails/` | Risk state store, crypto validator, MT5 validator |
| `src/scheduler/index.ts` | setInterval task management per agent |
| `src/db/index.ts` | SQLite functions including dbGetCycleById, dbGetLogsForCycle, dbGetCycleResults |
| `src/server/index.ts` | All API endpoints |
| `src/llm/openrouter.ts` | OpenRouter adapter with RateLimitError detection |

---

## Agent System Prompt Architecture

1. `buildSystemPrompt(config, agentKey)` in `src/agent/index.ts`
2. Sections: ROLE → PROCESS → RISK RULES → MT5 POSITION MANAGEMENT → RECENT PERFORMANCE → EXECUTION RULES → DECISION FORMAT
3. `customPrompt` appended last as "ADDITIONAL INSTRUCTIONS:"
4. Output controls: EXECUTION RULES tell agent when to call which tool; DECISION FORMAT defines the text line Claude must write
5. Full prompt viewable via GET /api/system-prompt/:key

---

## Market Types

- `'crypto' | 'mt5'` only — forex removed entirely

---

## MT5 Bridge Behaviour

- One active connection at a time; other accounts show "Not active" in UI
- Symbols: broker-native, no SYMBOL_MAP — symbols loaded from bridge's /symbols endpoint per account
- Python FastAPI at 127.0.0.1:8000

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| ANTHROPIC_API_KEY | — | Anthropic API key |
| CLAUDE_MODEL | claude-opus-4-5-20251101 | Default Claude model |
| OPENROUTER_API_KEY | — | OpenRouter API key |
| BINANCE_API_KEY | — | Binance API key |
| BINANCE_API_SECRET | — | Binance API secret |
| BINANCE_TESTNET | — | Use Binance testnet |
| MT5_BRIDGE_PORT | 8000 | MT5 bridge port |
| MT5_MAGIC | — | MT5 magic number |
| MT5_DEVIATION | — | MT5 slippage deviation |
| PORT | 3000 | Backend server port |
| MAX_DAILY_LOSS_USD | $200 | Daily loss limit |
| MAX_POSITION_USD | $1000 | Per-position size cap |
| MAX_SPREAD_PIPS | 3 | Max spread filter |
| MIN_STOP_PIPS | 10 | Minimum stop distance |
| MAX_COMBINED_NOTIONAL_USD | $2000 | Combined notional cap |

---

## Known Issues / Pending Work

1. **No HTTP timeout on MT5 bridge calls** — hanging bridge freezes agent cycle indefinitely
2. **Auto-execute safety net risky with cheap models** — if LLM writes decision text without calling the tool, agent executes anyway; should be config-gated
3. **remainingBudgetUsd can go negative** — no post-fill reconciliation if fill arrives after daily limit hit
4. **Notional cap only checked on BUY** — SELL positions add exposure but are not checked
5. **stopPips validation flat (10 pips)** — not symbol-aware (ATR-based would be better)
6. **lastKnownPositions Map leaks** — no cleanup when agents are deleted
7. **Frontend has no ErrorBoundary** — single API failure can crash entire app
8. **Log buffer (500 entries)** — fast agents lose log visibility
9. **Reports loads ALL trades** — no pagination, will be slow with large history
10. **No WebSocket/SSE** — everything is polling (2s logs, 5s agent state)
11. **node-cron in package.json** — unused dependency
12. **No DB migration system** — schema changes via ALTER TABLE + try/catch
13. **MT5 bridge has no auth** — open REST API on localhost

---

## Discussed but Not Yet Implemented

- **Dynamic symbol loading on agent create** — symbols should load from broker/account when user selects market+account, rather than static list; backend /api/symbols already supports this but needs frontend wiring in AgentCreate
- **Remove duplicate-symbol validation** — currently prevents creating two agents for the same symbol; should be removed
- **Manual position close detection** — piggybacked on get_snapshot cycle, compare lastKnownPositions vs current, fetch /history/deals for P&L, inject note to LLM; implementation discussed but not yet coded
- **Agent context for open/pending orders** — improve buildCycleUserMessage to include current open positions + pending orders as pre-fetched context before LLM call (so LLM knows state upfront, not just via get_snapshot tool)
- **Manually closed position P&L in totals** — when external close detected, record P&L via /history/deals lookup and add to cycle results for accurate reporting
