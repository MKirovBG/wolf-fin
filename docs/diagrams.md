# Wolf-Fin — Eraser.io Diagrams

Copy each code block into a new Eraser diagram. Set the diagram type as indicated.

---

## Diagram 1 — System Architecture
**Eraser type:** Cloud Architecture Diagram

```
colorMode bold
styleMode shadow
typeface clean
direction right

// ─── External Actor ──────────────────────────────────────────────────────────
Trader [icon: user, color: gray, label: "Trader\n(Browser)"]

// ─── Frontend ─────────────────────────────────────────────────────────────────
Frontend [color: blue] {
  Dashboard [icon: monitor, color: blue, label: "Dashboard\nReact + Vite"]
  AgentsPage [icon: list, color: blue, label: "Agents Page\nCreate / Control"]
  ReportsPage [icon: bar-chart-2, color: blue, label: "Reports &\nPositions"]
  SettingsPage [icon: settings, color: blue, label: "Settings\nAPI Keys"]
}

// ─── Backend ──────────────────────────────────────────────────────────────────
Backend [color: green] {
  API [icon: server, color: green, label: "Fastify API\nREST Endpoints"]
  AgentEngine [icon: cpu, color: green, label: "Agent Engine\nLLM Loop"]
  Scheduler [icon: clock, color: green, label: "Scheduler\nnode-cron"]
  Guardrails [icon: shield, color: green, label: "Guardrails\nRisk Controls"]
  SQLite [icon: database, color: green, label: "SQLite\ndata/wolf-fin.db"]
}

// ─── LLM Providers ────────────────────────────────────────────────────────────
LLM [color: purple] {
  Anthropic [icon: cloud, color: purple, label: "Anthropic\nClaude API"]
  OpenRouter [icon: cloud, color: purple, label: "OpenRouter\nMulti-LLM Gateway"]
}

// ─── MT5 Stack ────────────────────────────────────────────────────────────────
MT5Stack [color: orange] {
  Bridge [icon: terminal, color: orange, label: "MT5 Bridge\nPython FastAPI :8000"]
  MT5Terminal [icon: monitor, color: orange, label: "MT5 Terminal\nWindows Client"]
  EquitiBroker [icon: server, color: orange, label: "Equiti Broker\nLive / Demo Server"]
}

// ─── Exchanges ────────────────────────────────────────────────────────────────
Exchanges [color: red] {
  Binance [icon: dollar-sign, color: red, label: "Binance\nCrypto Spot"]
  Alpaca [icon: trending-up, color: red, label: "Alpaca\nForex Paper/Live"]
}

// ─── Market Data ──────────────────────────────────────────────────────────────
MarketData [color: yellow] {
  TwelveData [icon: bar-chart-2, color: yellow, label: "Twelve Data\nForex Candles"]
  CoinGecko [icon: pie-chart, color: yellow, label: "CoinGecko\nMarket Cap"]
  Finnhub [icon: calendar, color: yellow, label: "Finnhub\nEcon Calendar"]
  CryptoPanic [icon: rss, color: yellow, label: "CryptoPanic\nCrypto News"]
  AltMe [icon: activity, color: yellow, label: "Alternative.me\nFear & Greed"]
}

// ─── Connections ──────────────────────────────────────────────────────────────
Trader <> Dashboard: Browser
Trader <> AgentsPage: Browser
Trader <> ReportsPage: Browser
Trader <> SettingsPage: Browser

Dashboard <> API: HTTP /api/status
AgentsPage <> API: HTTP /api/agents
ReportsPage <> API: HTTP /api/reports
SettingsPage <> API: HTTP /api/keys

API <> AgentEngine: runAgentCycle()
API <> SQLite: Read / Write
Scheduler > AgentEngine: Trigger cycle
AgentEngine > Guardrails: validateOrder()
AgentEngine > SQLite: Record cycle + logs

AgentEngine > Anthropic: Claude API (tool-use)
AgentEngine > OpenRouter: OpenAI-compat API

AgentEngine > Bridge: HTTP localhost:8000
Bridge <> MT5Terminal: MetaTrader5 Python lib
MT5Terminal <> EquitiBroker: MT5 Protocol

AgentEngine > Binance: Binance SDK
AgentEngine > Alpaca: Alpaca REST API
AgentEngine > TwelveData: REST API
AgentEngine > CoinGecko: REST API
AgentEngine > Finnhub: REST API
AgentEngine > CryptoPanic: REST API
AgentEngine > AltMe: REST API
```

---

## Diagram 2 — Agent Trading Cycle
**Eraser type:** Sequence Diagram

```
typeface clean

title Wolf-Fin — Agent Trading Cycle

Trader [icon: user, color: gray]
Frontend [icon: monitor, color: blue]
Backend [icon: server, color: green]
Claude [icon: cloud, color: purple, label: "Claude / OpenRouter"]
Bridge [icon: terminal, color: orange, label: "MT5 Bridge"]
MT5 [icon: monitor, color: orange, label: "MT5 Terminal"]
Guardrails [icon: shield, color: green]
DB [icon: database, color: green]

Trader > Frontend: Click "Trigger" or scheduler fires
Frontend > Backend: POST /api/agents/mt5:XAUUSD/trigger
Backend > Backend: tryAcquireCycleLock()
Backend > DB: logEvent(cycle_start)
Backend > Claude: System prompt + tools (iteration 1)

activate Claude
Claude > Backend: tool_use: get_snapshot(XAUUSD, mt5)
deactivate Claude

Backend > Bridge: GET /snapshot/XAUUSD?accountId=1111343
Bridge > MT5: mt5.copy_rates_from_pos() × 4 timeframes
MT5 --> Bridge: OHLCV candles M1/M15/H1/H4
Bridge --> Backend: MarketSnapshot JSON
Backend > DB: logEvent(tool_result)
Backend > Claude: tool_result (price, candles, indicators, account)

activate Claude
Claude > Backend: tool_use: get_order_book(XAUUSD, mt5)
deactivate Claude

Backend > Bridge: GET /orderbook/XAUUSD
Bridge --> Backend: bids/asks (empty for retail broker)
Backend > Claude: tool_result

activate Claude
Claude > Backend: tool_use: place_order(SELL, 0.01, XAUUSD, stopPips=40)
deactivate Claude

Backend > Guardrails: validateMt5Order(params, spread, sessionOpen)
Guardrails --> Backend: { ok: true }

alt paper: false (LIVE)
  Backend > Bridge: POST /order {action:SELL, volume:0.01, sl:5052.00}
  Bridge > MT5: mt5.order_send(request)
  MT5 --> Bridge: retcode 10009 (TRADE_RETCODE_DONE)
  Bridge --> Backend: { deal: 987654, order: 123456, price: 5012.50 }
  Backend > DB: logEvent(tool_result)
  Backend > Claude: tool_result { status: FILLED, orderId: 123456 }
else paper: true (PAPER)
  Backend --> Claude: tool_result { status: PAPER_FILLED, orderId: simulated }
end

activate Claude
Claude > Backend: end_turn\nDECISION: SELL 0.01 @ 5012.5\nREASON: Bearish EMA cross…
deactivate Claude

Backend > DB: dbRecordCycle(agent_key, result)
Backend > DB: logEvent(decision)
Backend > DB: releaseCycleLock()
Backend --> Frontend: Cycle complete
Frontend --> Trader: Decision shown in log terminal
```

---

## Diagram 3 — Functional Flow (User Journey)
**Eraser type:** Flowchart

```
typeface clean
colorMode bold

// ─── Setup Phase ──────────────────────────────────────────────────────────────
Start [shape: oval, color: green, label: "User Opens\nWolf-Fin"]
ConfigureKeys [shape: rectangle, color: blue, label: "Settings Page\nAdd API Keys\n(Anthropic / OpenRouter\nBinance / Alpaca)"]
CreateAgent [shape: rectangle, color: blue, label: "Agents Page\nCreate Agent\n• Symbol (XAUUSD)\n• Market (MT5)\n• MT5 Account\n• LLM Provider\n• Paper / Live\n• Schedule interval"]
StartAgent [shape: rectangle, color: blue, label: "Click Start\n→ Scheduler activates"]

// ─── Cycle Trigger ────────────────────────────────────────────────────────────
TriggerType [shape: diamond, color: green, label: "Cycle Trigger"]
ManualTrigger [shape: rectangle, color: green, label: "Manual\nClick Trigger"]
ScheduledTrigger [shape: rectangle, color: green, label: "Scheduled\nCron fires every N min"]
AutonomousTrigger [shape: rectangle, color: green, label: "Autonomous\nAuto + session check"]

// ─── Risk Gate ────────────────────────────────────────────────────────────────
RiskGate [shape: diamond, color: red, label: "Daily Loss\nLimit Hit?"]
HoldRisk [shape: rectangle, color: red, label: "HOLD\nLog: guardrail_block"]

// ─── LLM Analysis Loop ────────────────────────────────────────────────────────
BuildPrompt [shape: rectangle, color: purple, label: "Build System Prompt\n• Strategy rules\n• Recent performance\n• Custom prompt"]
SendToLLM [shape: rectangle, color: purple, label: "Send to LLM\n(Claude or OpenRouter model)"]
LLMResponse [shape: diamond, color: purple, label: "LLM Response\nType?"]
ToolCall [shape: rectangle, color: purple, label: "Tool Call\n• get_snapshot\n• get_order_book\n• get_recent_trades\n• get_open_orders"]
ExecuteTool [shape: rectangle, color: green, label: "Execute Tool\n→ MT5 Bridge / Exchange\nReturn data to LLM"]
PlaceOrderCall [shape: rectangle, color: orange, label: "Tool Call\nplace_order()\nor cancel_order()"]
MaxIter [shape: diamond, color: purple, label: "Max iterations\nreached?"]

// ─── Order Validation ─────────────────────────────────────────────────────────
Validate [shape: diamond, color: red, label: "Guardrail\nCheck Pass?"]
BlockOrder [shape: rectangle, color: red, label: "Reject Order\nReturn error to LLM\nLLM decides: HOLD"]

// ─── Execution ────────────────────────────────────────────────────────────────
PaperMode [shape: diamond, color: orange, label: "Paper\nMode?"]
SimulatedFill [shape: rectangle, color: orange, label: "PAPER_FILLED\n(Simulated — no real order)"]
LiveExecution [shape: rectangle, color: orange, label: "Send to Exchange\nMT5 Bridge → MT5 Terminal\nor Binance / Alpaca API"]
OrderResult [shape: rectangle, color: orange, label: "Order Confirmed\nretcode 10009\nDeal ticket returned"]

// ─── Final Decision ───────────────────────────────────────────────────────────
EndTurn [shape: rectangle, color: purple, label: "LLM end_turn\nExtract DECISION text"]
RecordResult [shape: rectangle, color: green, label: "Record to DB\n• cycle_results table\n• log_entries table\n• Update agent state"]

// ─── Monitoring ───────────────────────────────────────────────────────────────
Dashboard [shape: rectangle, color: blue, label: "Dashboard Updates\n• Decision in log terminal\n• Stats cards refresh\n• P&L chart updates"]
End [shape: oval, color: green, label: "Cycle Complete\nNext cycle waits"]

// ─── Connections ──────────────────────────────────────────────────────────────
Start > ConfigureKeys
ConfigureKeys > CreateAgent
CreateAgent > StartAgent
StartAgent > TriggerType

TriggerType > ManualTrigger: manual
TriggerType > ScheduledTrigger: scheduled
TriggerType > AutonomousTrigger: autonomous

ManualTrigger > RiskGate
ScheduledTrigger > RiskGate
AutonomousTrigger > RiskGate

RiskGate > HoldRisk: Yes
RiskGate > BuildPrompt: No

BuildPrompt > SendToLLM
SendToLLM > LLMResponse

LLMResponse > ToolCall: tool_use (data)
LLMResponse > PlaceOrderCall: tool_use (order)
LLMResponse > EndTurn: end_turn

ToolCall > ExecuteTool
ExecuteTool > SendToLLM

PlaceOrderCall > Validate
Validate > BlockOrder: Fail
Validate > PaperMode: Pass

BlockOrder > SendToLLM

MaxIter > EndTurn: Yes
MaxIter > SendToLLM: No

PaperMode > SimulatedFill: Yes
PaperMode > LiveExecution: No

SimulatedFill > SendToLLM
LiveExecution > OrderResult
OrderResult > SendToLLM

EndTurn > RecordResult
HoldRisk > RecordResult
RecordResult > Dashboard
Dashboard > End
```

---

## Diagram 4 — Data Model (Entity Relationship)
**Eraser type:** Entity Relationship Diagram

```
typeface clean
colorMode bold

agents [color: green] {
  key [pk]
  config
  status
  cycle_count
  started_at
  last_cycle
}

cycle_results [color: blue] {
  id [pk]
  agent_key [ref: > agents.key]
  symbol
  market
  paper
  decision
  reason
  time
  error
  pnl_usd
}

log_entries [color: purple] {
  id [pk]
  time
  agent_key [ref: > agents.key]
  level
  event
  message
  data
}

settings [color: orange] {
  key [pk]
  value
}
```

---

## Diagram 5 — Deployment & Infrastructure
**Eraser type:** Cloud Architecture Diagram

```
colorMode bold
styleMode shadow
typeface clean

// ─── Windows Machine (flat — all nodes one level deep) ────────────────────────
WindowsMachine [color: gray] {
  MT5Terminal [icon: monitor, color: orange, label: "MetaTrader 5\nTerminal"]
  PyBridge [icon: terminal, color: orange, label: "Python FastAPI\nuvicorn :8000\nmt5-bridge/main.py"]
  NodeServer [icon: server, color: green, label: "Node.js :3000\nFastify Backend\nnpm start"]
  NodeDB [icon: database, color: green, label: "SQLite\ndata/wolf-fin.db"]
  FrontendDist [icon: globe, color: blue, label: "React SPA\nfrontend-dist/\nserved by Fastify"]
  EnvFile [icon: file, color: gray, label: ".env\nAPI Keys & Config"]
  AccountsFile [icon: file, color: gray, label: "mt5_accounts.json\nRegistered MT5 accounts"]
}

// ─── Browser ──────────────────────────────────────────────────────────────────
Browser [icon: chrome, color: blue, label: "Chrome / Browser\nlocalhost:3000"]

// ─── External APIs ────────────────────────────────────────────────────────────
ExternalAPIs [color: purple] {
  AnthropicCloud [icon: cloud, color: purple, label: "Anthropic API\napi.anthropic.com"]
  OpenRouterCloud [icon: cloud, color: purple, label: "OpenRouter\nopenrouter.ai"]
  BinanceCloud [icon: cloud, color: red, label: "Binance\napi.binance.com"]
  AlpacaCloud [icon: cloud, color: red, label: "Alpaca\npaper-api.alpaca.markets"]
  DataAPIs [icon: cloud, color: yellow, label: "Data APIs\nTwelve Data · CoinGecko\nFinnhub · CryptoPanic"]
}

// ─── Broker ───────────────────────────────────────────────────────────────────
Broker [icon: server, color: orange, label: "Equiti Broker\nequitibrokerage.com\nMT5 Protocol"]

// ─── Connections ──────────────────────────────────────────────────────────────
Browser <> FrontendDist: localhost:3000
Browser <> NodeServer: HTTP REST

NodeServer <> NodeDB: better-sqlite3
NodeServer > PyBridge: HTTP 127.0.0.1:8000
NodeServer > AnthropicCloud: HTTPS Claude API
NodeServer > OpenRouterCloud: HTTPS OpenAI-compat
NodeServer > BinanceCloud: HTTPS REST
NodeServer > AlpacaCloud: HTTPS REST
NodeServer > DataAPIs: HTTPS REST

PyBridge <> MT5Terminal: MetaTrader5 IPC
MT5Terminal <> Broker: MT5 Protocol

EnvFile > NodeServer: process.env
AccountsFile > PyBridge: load_accounts_config
```
