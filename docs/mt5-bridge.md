# Wolf-Fin — MT5 Bridge Documentation

**Language:** Python 3.13
**Framework:** FastAPI + Uvicorn
**MT5 package:** `MetaTrader5` (official Pythonic wrapper — Windows only)
**File:** `mt5-bridge/main.py`
**Default port:** `8000` (override via `MT5_BRIDGE_PORT` env)
**Config file:** `mt5-bridge/mt5_accounts.json`

---

## Purpose

The MT5 Bridge is a lightweight REST microservice that wraps the official `MetaTrader5` Python package. It runs **locally on the same Windows machine as MetaTrader5** and exposes every MT5 operation (market data, account info, order execution) over HTTP so the Node.js backend can consume it without needing Python.

```
Node.js backend (TypeScript)
    └─► MT5Adapter.getSnapshot()
            └─► HTTP GET http://127.0.0.1:8000/snapshot/XAUUSD
                    └─► Python mt5.copy_rates_from_pos(...)
                            └─► MetaTrader5 terminal (Windows)
                                    └─► Broker server
```

---

## Running the Bridge

```bash
cd mt5-bridge

# Install dependencies
pip install fastapi uvicorn MetaTrader5

# Start (development — auto-reload on file change)
uvicorn main:app --reload --port 8000

# Start (production)
uvicorn main:app --host 127.0.0.1 --port 8000
```

The bridge must be running **before** the Node.js backend starts, and MT5 terminal must be open and logged into at least one account.

---

## Multi-Account Architecture

The bridge supports multiple MT5 accounts registered in `mt5_accounts.json`. Each HTTP request can optionally include `?accountId={login}` to switch context before the operation.

**Account switching (`ensure_account`):**
```python
def ensure_account(account_id: Optional[int] = None) -> None:
    # No-op if account_id not provided
    if account_id is None: return
    # Try switching with empty password first (already authorised in terminal)
    if not mt5.login(account_id, "", ""):
        # Fall back to server lookup from config
        mt5.login(account_id, "", acc["server"])
```

> Accounts must already be **authorised in the MT5 terminal** (logged in at least once interactively). The bridge cannot authenticate with passwords — it only switches between pre-authorised sessions.

---

## Account Configuration (`mt5_accounts.json`)

```json
{
  "accounts": [
    { "login": 1013336511, "server": "EquitiBrokerageSC-Live", "name": "EUR Live" },
    { "login": 1511022881, "server": "FTMO-Demo",               "name": "FTMO Demo" },
    { "login": 1111343,    "server": "EquitiBrokerageSC-Demo",  "name": "EUR Demo" }
  ]
}
```

Loaded at runtime — edit and restart bridge to update.

---

## Symbol Mapping

### `SYMBOL_MAP`

Brokers often append suffixes to symbol names (`.sd`, `.lv`, `m`, etc.). The map translates generic Wolf-Fin symbol names to broker-specific names:

```python
SYMBOL_MAP: dict[str, str] = {
    # Equiti STP/SD account
    "BTCUSD":    "BTCUSD.lv",
    "EURUSD":    "EURUSD",
    "GBPUSD":    "GBPUSD",
    "USDJPY":    "USDJPY.sd",
    "USDCHF":    "USDCHF.sd",
    "AUDUSD":    "AUDUSD.sd",
    "NZDUSD":    "NZDUSD.sd",
    "USDCAD":    "USDCAD.sd",
    "EURGBP":    "EURGBP.sd",
    "EURJPY":    "EURJPY.sd",
    "GBPJPY":    "GBPJPY.sd",
    "XAUUSD":    "XAUUSD.sd",   # Gold — .sd is the tradeable instrument
    "XAGUSD":    "XAGUSD.sd",   # Silver
    "XAUUSD.SD": "XAUUSD.sd",   # Case-normalisation variant
}
```

**How it works:**
```python
def normalize_symbol(symbol: str) -> str:
    """Wolf-Fin format (e.g. XAU_USD) → MT5 broker format (XAUUSD.sd)"""
    clean = symbol.upper().replace("_", "")   # XAU_USD → XAUUSD
    return SYMBOL_MAP.get(clean, clean)        # XAUUSD → XAUUSD.sd

def to_wolfin_symbol(symbol: str) -> str:
    """MT5 format → Wolf-Fin format (strip broker suffix, add _ for 6-char FX pairs)"""
```

> **When to update:** If your broker uses different symbol names or you add new instruments, add them to `SYMBOL_MAP` and restart the bridge.

---

## Symbol Trade Modes

The `trade_mode` field from `mt5.symbol_info()` controls what orders are allowed:

| Value | Constant | Meaning |
|-------|----------|---------|
| `0` | `SYMBOL_TRADE_MODE_DISABLED` | No trading allowed — `10017` error |
| `1` | `SYMBOL_TRADE_MODE_LONGONLY` | Only BUY orders |
| `2` | `SYMBOL_TRADE_MODE_SHORTONLY` | Only SELL orders |
| `3` | `SYMBOL_TRADE_MODE_CLOSEONLY` | Only close existing positions |
| `4` | `SYMBOL_TRADE_MODE_FULL` | Full trading access |

The bridge exposes `session_open` as `info.trade_mode > 0` — if `0`, the agent will HOLD and not attempt orders.

---

## REST API Reference

### Health & Connection

#### `GET /health`
Check MT5 connection and active account.

**Response:**
```json
{
  "connected": true,
  "terminal": { "build": 3850, "connected": true },
  "account": {
    "login": 1111343,
    "server": "EquitiBrokerageSC-Demo",
    "trade_mode": 0,
    "leverage": 100,
    "balance": 10000.0
  }
}
```

#### `POST /health/reconnect`
Shutdown and reinitialise MT5 connection. Use if terminal disconnects.

---

### Account Management

#### `GET /accounts`
List all accounts registered in `mt5_accounts.json` plus the currently active login.

**Response:**
```json
{
  "current_login": 1111343,
  "accounts": [
    {
      "login": 1013336511,
      "name": "EUR Live",
      "server": "EquitiBrokerageSC-Live",
      "registered_at": "2026-01-01T00:00:00"
    }
  ]
}
```

#### `POST /accounts/register`
Register a new account in `mt5_accounts.json`.

**Body:**
```json
{
  "login": 9999999,
  "password": "optional_for_terminal_auth",
  "server": "Broker-Live",
  "name": "My Account"
}
```

#### `POST /accounts/switch?login={accountId}`
Switch the active MT5 session to a registered account.

---

### Symbol Information

#### `GET /symbols?search={query}`
List symbols available in Market Watch. Optional search filter.

**Response:**
```json
{
  "symbols": ["EURUSD", "XAUUSD.sd", "GBPUSD", "BTCUSD.lv", "…"]
}
```

#### `GET /symbol-info/{symbol}?accountId={id}`
Full specification for a symbol.

**Response:**
```json
{
  "symbol": "XAUUSD.sd",
  "point": 0.01,
  "digits": 2,
  "spread": 21,
  "spread_float": 0.21,
  "swap_long": -32.186,
  "swap_short": 24.776,
  "trade_mode": 4,
  "trade_contract_size": 100,
  "volume_min": 0.01,
  "volume_max": 100.0,
  "volume_step": 0.01,
  "currency_base": "XAU",
  "currency_profit": "USD",
  "currency_margin": "XAU",
  "description": "Gold vs US Dollar"
}
```

**`trade_mode: 4`** = Full access. `trade_mode: 0` = disabled (causes `10017` error on orders).

---

### Market Data

#### `GET /snapshot/{symbol}?accountId={id}`

The primary data endpoint — returns everything the agent needs for one cycle.

**Response:**
```json
{
  "symbol": "XAU_USD",
  "price": {
    "bid": 5012.45,
    "ask": 5012.66,
    "last": 5012.55
  },
  "candles": {
    "m1":  [ { "openTime": 1710000000000, "open": 5010.1, "high": 5013.2, "low": 5009.8, "close": 5012.5, "volume": 142, "closeTime": 1710000059999 }, "…99 more" ],
    "m15": [ "…100 bars" ],
    "h1":  [ "…100 bars" ],
    "h4":  [ "…100 bars" ]
  },
  "symbol_info": {
    "spread": 21,
    "point": 0.01,
    "digits": 2,
    "swap_long": -32.186,
    "swap_short": 24.776,
    "trade_mode": 4,
    "volume_min": 0.01,
    "volume_max": 100.0,
    "volume_step": 0.01,
    "trade_contract_size": 100,
    "session_open": true
  },
  "account": {
    "balance": 10000.0,
    "equity": 10000.0,
    "margin": 0.0,
    "free_margin": 10000.0,
    "profit": 0.0,
    "leverage": 100,
    "login": 1111343,
    "server": "EquitiBrokerageSC-Demo"
  },
  "positions": []
}
```

**Candle fields:**
| Field | Description |
|-------|-------------|
| `openTime` | Bar open time (Unix ms) |
| `open` | Open price |
| `high` | High price |
| `low` | Low price |
| `close` | Close price |
| `volume` | Tick volume (number of ticks) |
| `closeTime` | Bar close time = openTime + timeframe_ms - 1 |

**`session_open` computation:** `info.trade_mode > 0` — `false` when broker disables trading outside hours.

---

#### `GET /candles/{symbol}?timeframe=M15&count=100&accountId={id}`

Fetch candles for a single timeframe.

**Timeframe options:** `M1`, `M5`, `M15`, `M30`, `H1`, `H4`, `D1`, `W1`, `MN1`

**Response:**
```json
{
  "symbol": "XAU_USD",
  "timeframe": "M15",
  "candles": [ { "openTime": …, "open": …, "high": …, "low": …, "close": …, "volume": …, "closeTime": … } ]
}
```

---

#### `GET /orderbook/{symbol}?depth=20&accountId={id}`

Market depth (Level 2). Requires the symbol to support DOM data.

**Response:**
```json
{
  "symbol": "XAU_USD",
  "bids": [[5012.40, 1.5], [5012.30, 2.0]],
  "asks": [[5012.70, 1.0], [5012.80, 3.5]],
  "timestamp": 1710000000000
}
```

> Most retail MT5 brokers do not stream DOM data — this typically returns empty arrays. The agent handles this gracefully.

---

#### `GET /trades/{symbol}?count=50&accountId={id}`

Recent public ticks (trade tape).

**Response:**
```json
{
  "symbol": "XAU_USD",
  "trades": [
    {
      "price": 5012.55,
      "volume": 0.1,
      "time": 1710000000000,
      "isBuyerMaker": false
    }
  ]
}
```

---

### Account & Positions

#### `GET /account?accountId={id}`

Full account info for the active or specified account.

**Response:**
```json
{
  "login": 1111343,
  "server": "EquitiBrokerageSC-Demo",
  "trade_mode": 0,
  "balance": 10000.0,
  "equity": 10000.0,
  "margin": 0.0,
  "free_margin": 10000.0,
  "profit": 0.0,
  "leverage": 100,
  "currency": "USD",
  "name": "John Demo",
  "company": "Equiti Brokerage"
}
```

**`trade_mode` on account:** `0` = demo, `1` = contest, `2` = real/live

---

#### `GET /positions?symbol={sym}&accountId={id}`

Open positions (live trades). Omit `symbol` for all positions.

**Response (array):**
```json
[
  {
    "ticket": 123456789,
    "symbol": "XAUUSD.sd",
    "side": "SELL",
    "volume": 0.10,
    "priceOpen": 5012.50,
    "priceCurrent": 5010.20,
    "profit": 23.00,
    "swap": -0.15,
    "sl": 5025.00,
    "tp": 0.0,
    "magic": 123456,
    "comment": "wolf-fin",
    "time": "2026-03-16T21:39:25+00:00"
  }
]
```

---

#### `GET /orders?symbol={sym}&accountId={id}`

Pending (unfilled) limit/stop orders. Same format as positions but for pending queue.

---

#### `GET /history/deals?symbol={sym}&days=7&limit=50&accountId={id}`

Closed trade history (filled deals).

**Response (array, newest first):**
```json
[
  {
    "ticket": 987654321,
    "order": 123456789,
    "symbol": "XAUUSD.sd",
    "type": "sell",
    "volume": 0.10,
    "price": 5010.20,
    "profit": 23.00,
    "commission": -0.50,
    "swap": -0.15,
    "fee": 0.0,
    "magic": 123456,
    "comment": "wolf-fin",
    "time": "2026-03-16T22:00:00+00:00"
  }
]
```

---

### Order Execution

#### `POST /order`

Place a market or limit order.

**Request body (`OrderRequest`):**
```json
{
  "symbol": "XAUUSD",
  "action": "SELL",
  "order_type": "MARKET",
  "volume": 0.10,
  "price": null,
  "sl": 5025.00,
  "tp": null,
  "deviation": 10,
  "magic": 123456,
  "comment": "wolf-fin",
  "accountId": 1111343
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `symbol` | string | Yes | Normalised via `SYMBOL_MAP` |
| `action` | `"BUY"` \| `"SELL"` | Yes | |
| `order_type` | `"MARKET"` \| `"LIMIT"` | No | Default `"MARKET"` |
| `volume` | float | Yes | In lots (min: `volume_min` from symbol info) |
| `price` | float | LIMIT only | Entry price for pending order |
| `sl` | float | No | Absolute stop-loss price |
| `tp` | float | No | Absolute take-profit price |
| `deviation` | int | No | Max slippage in points (default 10) |
| `magic` | int | No | Order identifier label (default 123456) |
| `comment` | string | No | Order comment (default "wolf-fin") |
| `accountId` | int | No | Switch account before placing |

**MT5 internal mapping:**

| Wolf-Fin | MT5 constant |
|----------|-------------|
| `MARKET` | `TRADE_ACTION_DEAL` |
| `LIMIT` | `TRADE_ACTION_PENDING` |
| `BUY` + `MARKET` | `ORDER_TYPE_BUY` |
| `SELL` + `MARKET` | `ORDER_TYPE_SELL` |
| `BUY` + `LIMIT` | `ORDER_TYPE_BUY_LIMIT` |
| `SELL` + `LIMIT` | `ORDER_TYPE_SELL_LIMIT` |
| Filling | `ORDER_FILLING_IOC` |
| Time | `ORDER_TIME_GTC` |

**Successful response:**
```json
{
  "retcode": 10009,
  "deal": 987654321,
  "order": 123456789,
  "volume": 0.10,
  "price": 5012.55,
  "comment": "wolf-fin"
}
```

**Error responses:**

| HTTP | MT5 retcode | Meaning | Fix |
|------|-------------|---------|-----|
| 502 | `10017` | Trade disabled for symbol | Check `trade_mode` in symbol spec; use `.sd` variant |
| 502 | `10027` | AutoTrading disabled by client | Enable AutoTrading button in MT5 terminal |
| 502 | `10016` | Invalid stops | SL too close to current price |
| 502 | `10019` | Not enough money | Insufficient margin |
| 502 | `10014` | Invalid volume | Below `volume_min` or above `volume_max` |

---

#### `POST /order/close`

Close an open position by ticket.

**Request body:**
```json
{
  "ticket": 123456789,
  "volume": null,
  "accountId": 1111343
}
```

- `volume: null` → close full position
- `volume: 0.05` → partial close (must be ≤ current position volume)

---

#### `POST /order/cancel`

Cancel a pending (unfilled) order.

**Request body:**
```json
{
  "ticket": 123456789,
  "accountId": 1111343
}
```

---

## Data Mapper Functions

Internal Python functions that convert MT5 named tuples to JSON-serialisable dicts:

### `map_candle(rate)`
```python
{
    "openTime":  int(rate["time"]) * 1000,  # → Unix ms
    "open":      float(rate["open"]),
    "high":      float(rate["high"]),
    "low":       float(rate["low"]),
    "close":     float(rate["close"]),
    "volume":    int(rate["tick_volume"]),
    "closeTime": int(rate["time"]) * 1000 + timeframe_ms - 1
}
```

### `map_position(pos)`
```python
{
    "ticket":       pos.ticket,
    "symbol":       pos.symbol,
    "side":         "BUY" if pos.type == 0 else "SELL",
    "volume":       pos.volume,
    "priceOpen":    pos.price_open,
    "priceCurrent": pos.price_current,
    "profit":       pos.profit,
    "swap":         pos.swap,
    "sl":           pos.sl,
    "tp":           pos.tp,
    "magic":        pos.magic,
    "comment":      pos.comment,
    "time":         datetime.fromtimestamp(pos.time, tz=timezone.utc).isoformat()
}
```

### `map_deal(deal)`
```python
{
    "ticket":     deal.ticket,
    "order":      deal.order,
    "symbol":     deal.symbol,
    "type":       "buy" if deal.type == 0 else "sell",
    "volume":     deal.volume,
    "price":      deal.price,
    "profit":     deal.profit,
    "commission": deal.commission,
    "swap":       deal.swap,
    "fee":        deal.fee,
    "magic":      deal.magic,
    "comment":    deal.comment,
    "time":       datetime.fromtimestamp(deal.time, tz=timezone.utc).isoformat()
}
```

### `map_order(order)`
```python
{
    "ticket":          order.ticket,
    "symbol":          order.symbol,
    "type":            ORDER_TYPE_NAMES[order.type],  # "BUY_LIMIT", "SELL_STOP"…
    "volume_initial":  order.volume_initial,
    "volume_current":  order.volume_current,
    "price_open":      order.price_open,
    "sl":              order.sl,
    "tp":              order.tp,
    "price_current":   order.price_current,
    "state":           order.state,
    "magic":           order.magic,
    "comment":         order.comment,
    "time":            datetime.fromtimestamp(order.time_setup, tz=timezone.utc).isoformat()
}
```

---

## Lifecycle Events

### Startup (`@app.on_event("startup")`)
```python
if mt5.initialize():
    connected = True
    print(f"[mt5-bridge] Connected — login {info.login} on {info.server}")
else:
    connected = False
    print(f"[mt5-bridge] Failed: {code} — {msg}")
```

### Shutdown (`@app.on_event("shutdown")`)
```python
mt5.shutdown()
print("[mt5-bridge] MT5 shutdown")
```

All endpoints call `require_connected()` which raises HTTP 503 if `connected == False`.

---

## Common Errors & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `10017 — Trade disabled` | Symbol `trade_mode=0` on this account | Use `.sd` symbol variant, check symbol spec in MT5 |
| `10027 — AutoTrading disabled by client` | AutoTrading button is OFF in MT5 | Click AutoTrading button in MT5 toolbar (turns green) |
| `Symbol XAUUSD not found` | Account not active / symbol not in Market Watch | Switch to correct account; right-click Market Watch → Show All |
| `Could not switch to account XXXXX` | Account not logged into terminal | Log into the account in MT5 terminal first |
| `MT5 bridge HTTP 500` | Bridge crashed or MT5 terminal closed | Restart bridge; check MT5 terminal is open |
| `503 MT5 terminal not connected` | `mt5.initialize()` failed at startup | Ensure MT5 terminal is running before starting bridge |
| Empty order book (`bid=undefined`) | Broker doesn't stream DOM data | Normal for retail brokers — agent handles gracefully |
| `get_recent_trades ERROR 500` | Tick history unavailable for symbol | Normal for some symbols — agent continues without it |

---

## Broker-Specific Notes

### Equiti (EquitiBrokerageSC)
- Gold symbol: `XAUUSD.sd` (not plain `XAUUSD` — `trade_mode=0` on plain)
- EURUSD/GBPUSD: no suffix on standard accounts
- USDJPY and most others: `.sd` suffix
- BTCUSD: `.lv` suffix
- Filling mode: `IOC` (Immediate or Cancel) — orders must fill immediately or are cancelled

### FTMO
- Requires manual login authorisation in terminal before bridge can switch to it
- All instruments available without broker suffix
- Has trading hour restrictions — check session schedule in terminal

---

## Dependencies

```txt
fastapi>=0.100.0
uvicorn>=0.23.0
MetaTrader5>=5.0.45
pydantic>=2.0.0
```

Install:
```bash
pip install fastapi uvicorn MetaTrader5 pydantic
```

> **Windows only.** The `MetaTrader5` package is only available for Windows (requires the MT5 terminal). The bridge cannot run on Linux/macOS.
