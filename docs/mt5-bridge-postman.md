# MT5 Bridge — Postman Test Collection

**Base URL:** `http://127.0.0.1:8000`

---

## Starting the Bridge

### Step 1 — Open MetaTrader 5 terminal
Make sure your MT5 terminal is running and you are **logged in** to at least one account (account `1111343`). The bridge cannot connect if MT5 is closed.

### Step 2 — Enable AutoTrading in MT5
In the MT5 toolbar, click the **AutoTrading** button so it turns **green**. Without this, all order placement requests will return error `10027`.

### Step 3 — Start the bridge
Open a terminal in the `mt5-bridge/` folder and run:

```bash
cd mt5-bridge

# Option A — using start.bat (Windows, recommended)
start.bat

# Option B — manually
pip install fastapi uvicorn MetaTrader5
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

You should see:
```
[mt5-bridge] Connected — login 1111343 on EquitiBrokerageSC-Demo
INFO:     Uvicorn running on http://127.0.0.1:8000
```

### Step 4 — Verify bridge is up
Open a browser or Postman and hit:
```
GET http://127.0.0.1:8000/health
```
You should get `"connected": true`. If you get a connection error, the bridge isn't running. If you get `"connected": false`, MT5 terminal is closed or not responding.

### Troubleshooting
| Issue | Fix |
|-------|-----|
| `Connection refused` on port 8000 | Bridge not started — run `start.bat` |
| `"connected": false` | MT5 terminal is closed or crashed — reopen it then `POST /health/reconnect` |
| `ModuleNotFoundError: MetaTrader5` | Run `pip install MetaTrader5` — only works on Windows |
| `10027 — AutoTrading disabled` | Click AutoTrading button in MT5 toolbar (must be green) |
| `Could not switch to account X` | Log into that account in MT5 terminal first |

#OUTPUT
```json
{
    "connected": true,
    "terminal": {
        "build": 5687,
        "connected": true
    },
    "account": {
        "login": 1111343,
        "server": "EquitiBrokerageSC-Demo",
        "trade_mode": 0,
        "leverage": 500,
        "balance": 10000.86
    }
}
```

---

Set a Postman Collection Variable: `baseUrl = http://127.0.0.1:8000`

Known accounts for testing:
- `1111343` — EquitiBrokerageSC-Demo (currently active)
- `1013336511` — EquitiBrokerageSC-Live
- `1511022881` — FTMO-Demo

---

## 1. Health & Connection

### 1.1 Check connection status
```
GET {{baseUrl}}/health
```
**Expect:** `connected: true`, terminal build, active account login + balance

---

### 1.2 Reconnect MT5
```
POST {{baseUrl}}/health/reconnect
```
**Expect:** `{ "connected": true }` — use this if MT5 terminal was restarted

URL: http://127.0.0.1:8000/health/reconnect
TODO:
Response
```json
{
    "detail": "Method Not Allowed"
}
```

---

## 2. Account Management

### 2.1 List registered accounts
```
GET {{baseUrl}}/accounts
```
**Expect:** `current_login` + array of 3 registered accounts from `mt5_accounts.json`

---

### 2.2 Register a new account

POST {{baseUrl}}/accounts/register
Content-Type: application/json
```json
{
    "current_login": 1111343,
    "accounts": [
        {
            "login": 1013336511,
            "server": "EquitiBrokerageSC-Live",
            "name": "EUR Live"
        },
        {
            "login": 1511022881,
            "server": "FTMO-Demo",
            "name": "FTMO Demo"
        },
        {
            "login": 1111343,
            "server": "EquitiBrokerageSC-Demo",
            "name": "EUR Demo"
        }
    ]
}
```
**Expect:** `{ "message": "Account registered", "login": 9999999 }`

---

### 2.3 Switch active account
```
POST {{baseUrl}}/accounts/switch?login=1111343
```
**Expect:** `{ "switched": true, "login": 1111343 }`

> Note: Only works for accounts already logged into MT5 terminal

TODO:
URL: http://127.0.0.1:8000/accounts/switch?login=1111343
```json
{
    "detail": "Method Not Allowed"
}
```
---

## 3. Symbol Information

### 3.1 List all Market Watch symbols
```
GET {{baseUrl}}/symbols
```
**Expect:** Array of all symbols — look for `XAUUSD.sd`, `EURUSD`, `GBPUSD`

[Example](./json-files/mt5-symbols.json)

---

### 3.2 Search symbols
```
GET {{baseUrl}}/symbols?search=XAU
```
**Expect:** Filtered list containing all `XAU` pairs available with the broker

---

### 3.3 Symbol info — Gold (XAUUSD)
```
GET {{baseUrl}}/symbol-info/XAUUSD?accountId=1111343
```
**Expect:**
- `symbol: "XAUUSD.sd"` (mapped via SYMBOL_MAP)
- `trade_mode: 4` (Full access) ← if 0, trading is disabled
- `point: 0.01`
- `digits: 2`
- `spread: ~20` (in points)
- `volume_min: 0.01`
- `swap_long: negative` (cost to hold longs overnight)
- `swap_short: positive` (credit for holding shorts)

```json
{
    "symbol": "XAU_USD",
    "point": 0.01,
    "digits": 2,
    "spread": 34,
    "spread_float": 0.34,
    "swap_long": -11.41,
    "swap_short": 6.427,
    "trade_mode": 4,
    "trade_contract_size": 100.0,
    "volume_min": 0.01,
    "volume_max": 100.0,
    "volume_step": 0.01,
    "currency_base": "XAU",
    "currency_profit": "USD",
    "currency_margin": "XAU",
    "description": "Gold vs US Dollar"
}
```
---

### 3.4 Symbol info — EURUSD
```
GET {{baseUrl}}/symbol-info/EURUSD?accountId=1111343
```
**Expect:** `point: 0.00001`, `digits: 5`, `trade_mode: 4`

---

### 3.5 Symbol info — without accountId (uses current active account)
```
GET {{baseUrl}}/symbol-info/XAUUSD
```
**Expect:** Same response using whichever account is currently active in MT5

```json
{
    "symbol": "EUR_USD",
    "point": 0.00001,
    "digits": 5,
    "spread": 13,
    "spread_float": 0.00013000000000000002,
    "swap_long": -8.207,
    "swap_short": 4.327,
    "trade_mode": 0,
    "trade_contract_size": 100000.0,
    "volume_min": 0.01,
    "volume_max": 150.0,
    "volume_step": 0.01,
    "currency_base": "EUR",
    "currency_profit": "USD",
    "currency_margin": "EUR",
    "description": "Euro vs US Dollar"
}
```

---

## 4. Account Data

### 4.1 Active account info
```
GET {{baseUrl}}/account
```
**Expect:** balance, equity, margin, free_margin, leverage, login, server, currency

---

### 4.2 Specific account info
```
GET {{baseUrl}}/account?accountId=1111343
```
**Expect:** Info for account `1111343` — should show $10,000 demo balance

```json
{
    "login": 1111343,
    "server": "EquitiBrokerageSC-Demo",
    "trade_mode": 0,
    "balance": 10000.86,
    "equity": 10000.86,
    "margin": 0.0,
    "free_margin": 10000.86,
    "profit": 0.0,
    "leverage": 500,
    "currency": "USD",
    "name": "Miroslav Valentinov Kirov",
    "company": "Equiti Brokerage (Seychelles) Limited"
}
```

---

### 4.3 Live account info
```
GET {{baseUrl}}/account?accountId=1013336511
```
**Expect:** Info for Live account (only works if authorised in terminal)

During my testing i've discovered that when we make request and the account becomes active on the MT5 platform. The request above to /switch was not working during testing

```json
{
    "login": 1013336511,
    "server": "EquitiBrokerageSC-Live",
    "trade_mode": 2,
    "balance": 1.22,
    "equity": 1.22,
    "margin": 0.0,
    "free_margin": 1.22,
    "profit": 0.0,
    "leverage": 2000,
    "currency": "USD",
    "name": "Miroslav Kirov",
    "company": "Equiti Brokerage (Seychelles) Limited"
}
```

---

## 5. Market Data

### 5.1 Full snapshot — Gold
```
GET {{baseUrl}}/snapshot/XAUUSD?accountId=1111343
```
**Expect:**
- `price.bid`, `price.ask`, `price.last` — current gold price (~5000–5100)
- `candles.m1` — 100 one-minute bars
- `candles.m15` — 100 fifteen-minute bars
- `candles.h1` — 100 one-hour bars
- `candles.h4` — 100 four-hour bars
- `symbol_info.session_open: true` (if market is open)
- `account.balance: 10000`
- `positions: []` (empty if no open trades)

Again when i made the request this account became the current openned account on the MT5 platform and retrived the data

[Example](./json-files/mt5-symbol-candles.json)
---

### 5.2 Full snapshot — EURUSD
```
GET {{baseUrl}}/snapshot/EURUSD?accountId=1111343
```
**Expect:** Same structure, price ~1.08–1.16

---

### 5.3 Candles — M1 (most recent 50 bars)
```
GET {{baseUrl}}/candles/XAUUSD?timeframe=M1&count=50&accountId=1111343
```
**Expect:** Array of 50 candles `{openTime, open, high, low, close, volume, closeTime}`

[Example](./json-files/mt5-1m-candles.json)
---

### 5.4 Candles — H4 (100 bars)
```
GET {{baseUrl}}/candles/XAUUSD?timeframe=H4&count=100&accountId=1111343
```
**Expect:** 100 four-hour bars. `openTime` gaps should be 4 hours apart

---

### 5.5 Candles — Daily
```
GET {{baseUrl}}/candles/XAUUSD?timeframe=D1&count=30&accountId=1111343
```
**Expect:** 30 daily bars — useful for higher timeframe bias

---

### 5.6 Order book (market depth)
```
GET {{baseUrl}}/orderbook/XAUUSD?depth=10&accountId=1111343
```
**Expect:** `bids: []`, `asks: []` — most retail brokers return empty DOM. Not an error.


TODO: Why this is empty reponse and how if any data is rpesent is used?
```json
{
    "symbol": "XAU_USD",
    "bids": [],
    "asks": [],
    "timestamp": 1773735373786
}
```
---

### 5.7 Recent trades (tick tape)
```
GET {{baseUrl}}/trades/XAUUSD?count=20&accountId=1111343
```
**Expect:** Array of recent ticks `{price, volume, time, isBuyerMaker}` — or error 500 if tick history unavailable for this symbol (normal for some accounts)

TODO: Investigate the ERROR

Defaulting to user installation because normal site-packages is not writeable
Requirement already satisfied: MetaTrader5>=5.0.45 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from -r requirements.txt (line 1)) (5.0.5640)
Requirement already satisfied: fastapi>=0.115.0 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from -r requirements.txt (line 2)) (0.135.1)
Requirement already satisfied: uvicorn>=0.34.0 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from -r requirements.txt (line 3)) (0.42.0)
Requirement already satisfied: numpy>=1.7 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from MetaTrader5>=5.0.45->-r requirements.txt (line 1)) (2.4.3)
Requirement already satisfied: starlette>=0.46.0 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from fastapi>=0.115.0->-r requirements.txt (line 2)) (0.52.1)
Requirement already satisfied: pydantic>=2.7.0 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from fastapi>=0.115.0->-r requirements.txt (line 2)) (2.12.5)
Requirement already satisfied: typing-extensions>=4.8.0 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from fastapi>=0.115.0->-r requirements.txt (line 2)) (4.15.0)
Requirement already satisfied: typing-inspection>=0.4.2 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from fastapi>=0.115.0->-r requirements.txt (line 2)) (0.4.2)
Requirement already satisfied: annotated-doc>=0.0.2 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from fastapi>=0.115.0->-r requirements.txt (line 2)) (0.0.4)
Requirement already satisfied: click>=7.0 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from uvicorn>=0.34.0->-r requirements.txt (line 3)) (8.3.1)
Requirement already satisfied: h11>=0.8 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from uvicorn>=0.34.0->-r requirements.txt (line 3)) (0.16.0)
Requirement already satisfied: colorama in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from click>=7.0->uvicorn>=0.34.0->-r requirements.txt (line 3)) (0.4.6)
Requirement already satisfied: annotated-types>=0.6.0 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from pydantic>=2.7.0->fastapi>=0.115.0->-r requirements.txt (line 2)) (0.7.0)
Requirement already satisfied: pydantic-core==2.41.5 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from pydantic>=2.7.0->fastapi>=0.115.0->-r requirements.txt (line 2)) (2.41.5)
Requirement already satisfied: anyio<5,>=3.6.2 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from starlette>=0.46.0->fastapi>=0.115.0->-r requirements.txt (line 2)) (4.12.1)
Requirement already satisfied: idna>=2.8 in C:\Users\User\AppData\Roaming\Python\Python313\site-packages (from anyio<5,>=3.6.2->starlette>=0.46.0->fastapi>=0.115.0->-r requirements.txt (line 2)) (3.11)
INFO:     Started server process [28616]
INFO:     Waiting for application startup.
[mt5-bridge] Connected — login 1111343 on EquitiBrokerageSC-Demo
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)      
INFO:     127.0.0.1:63574 - "GET /trades/XAUUSD?count=20&accountId=1111343 HTTP/1.1" 500 Internal Server Error
ERROR:    Exception in ASGI application
Traceback (most recent call last):
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\uvicorn\protocols\http\h11_impl.py", line 410, in run_asgi
    result = await app(  # type: ignore[func-returns-value]
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
        self.scope, self.receive, self.send
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    )
    ^
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\uvicorn\middleware\proxy_headers.py", line 60, in __call__
    return await self.app(scope, receive, send)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\fastapi\applications.py", line 1160, in __call__
    await super().__call__(scope, receive, send)
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\starlette\applications.py", line 107, in __call__
    await self.middleware_stack(scope, receive, send)
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\starlette\middleware\errors.py", line 186, in __call__
    raise exc
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\starlette\middleware\errors.py", line 164, in __call__
    await self.app(scope, receive, _send)
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\starlette\middleware\exceptions.py", line 63, in __call__
    await wrap_app_handling_exceptions(self.app, conn)(scope, receive, send)   
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\starlette\_exception_handler.py", line 53, in wrapped_app
    raise exc
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\starlette\_exception_handler.py", line 42, in wrapped_app
    await app(scope, receive, sender)
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\fastapi\middleware\asyncexitstack.py", line 18, in __call__
    await self.app(scope, receive, send)
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\starlette\routing.py", line 716, in __call__
    await self.middleware_stack(scope, receive, send)
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\starlette\routing.py", line 736, in app
    await route.handle(scope, receive, send)
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\starlette\routing.py", line 290, in handle
    await self.app(scope, receive, send)
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\fastapi\routing.py", line 130, in app
    await wrap_app_handling_exceptions(app, request)(scope, receive, send)     
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\starlette\_exception_handler.py", line 53, in wrapped_app
    raise exc
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\starlette\_exception_handler.py", line 42, in wrapped_app
    await app(scope, receive, sender)
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\fastapi\routing.py", line 116, in app
    response = await f(request)
               ^^^^^^^^^^^^^^^^
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\fastapi\routing.py", line 670, in app
    raw_response = await run_endpoint_function(
                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    ...<3 lines>...
    )
    ^
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\fastapi\routing.py", line 326, in run_endpoint_function
    return await run_in_threadpool(dependant.call, **values)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\starlette\concurrency.py", line 32, in run_in_threadpool
    return await anyio.to_thread.run_sync(func)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\anyio\to_thread.py", line 63, in run_sync
    return await get_async_backend().run_sync_in_worker_thread(
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
        func, args, abandon_on_cancel=abandon_on_cancel, limiter=limiter       
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^       
    )
    ^
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\anyio\_backends\_asyncio.py", line 2502, in run_sync_in_worker_thread
    return await future
           ^^^^^^^^^^^^
  File "C:\Users\User\AppData\Roaming\Python\Python313\site-packages\anyio\_backends\_asyncio.py", line 986, in run
    result = context.run(func, *args)
  File "D:\User\Desktop\wolf-fin\wolf-fin\mt5-bridge\main.py", line 494, in get_recent_trades
    ticks = mt5.copy_ticks_from_pos(mt5_sym, 0, count, mt5.COPY_TICKS_TRADE)   
            ^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: module 'MetaTrader5' has no attribute 'copy_ticks_from_pos'. Did you mean: 'copy_rates_from_pos'?

---

## 6. Open Positions & Orders

### 6.1 All open positions
```
GET {{baseUrl}}/positions?accountId=1111343
```
**Expect:** Empty array `[]` if no open trades, or array of positions if trades are open

```json
[
    {
        "ticket": 107309560,
        "symbol": "XAU_USD",
        "side": "BUY",
        "volume": 0.01,
        "priceOpen": 5023.63,
        "priceCurrent": 5023.44,
        "profit": -0.19,
        "swap": 0.0,
        "sl": 0.0,
        "tp": 0.0,
        "magic": 0,
        "comment": "",
        "time": "2026-03-17T11:23:41+00:00"
    }
]
```

---

### 6.2 Positions filtered by symbol
```
GET {{baseUrl}}/positions?symbol=XAUUSD&accountId=1111343
```
**Expect:** Only positions for XAUUSD.sd

---

### 6.3 All pending orders
```
GET {{baseUrl}}/orders?accountId=1111343
```
**Expect:** Empty array if no pending limit/stop orders

```json
[
    {
        "ticket": 107310348,
        "symbol": "XAU_USD",
        "type": 3,
        "volume_initial": 0.01,
        "volume_current": 0.01,
        "price_open": 5043.11,
        "sl": 5045.11,
        "tp": 5004.09,
        "price_current": 5021.56,
        "state": 1,
        "magic": 0,
        "comment": "",
        "time": "2026-03-17T11:25:43+00:00"
    }
]
```

---

### 6.4 Pending orders for symbol
```
GET {{baseUrl}}/orders?symbol=XAUUSD&accountId=1111343
```
**Expect:** Filtered pending orders for gold

---

## 7. Trade History

### 7.1 All deals — last 7 days
```
GET {{baseUrl}}/history/deals?days=7&limit=50&accountId=1111343
```
**Expect:** Array of closed deals `{ticket, symbol, type, volume, price, profit, commission, time}`

```json
{
        "ticket": 97673728,
        "order": 107146592,
        "symbol": "XAU_USD",
        "type": 1,
        "volume": 0.01,
        "price": 5017.91,
        "profit": 0.86,
        "commission": 0.0,
        "swap": 0.0,
        "fee": 0.0,
        "magic": 0,
        "comment": "",
        "time": "2026-03-16T23:13:56+00:00"
    }
```
---

### 7.2 Gold trade history — last 30 days
```
GET {{baseUrl}}/history/deals?symbol=XAUUSD&days=30&limit=100&accountId=1111343
```
**Expect:** Only XAUUSD.sd deals (newest first)

---

## 8. Order Execution

> ⚠️ These requests place **real orders** on account `1111343` (demo). AutoTrading must be enabled in MT5.

### 8.1 Market SELL — Gold (0.01 lots)
```
POST {{baseUrl}}/order
Content-Type: application/json

{
  "symbol": "XAUUSD",
  "action": "SELL",
  "order_type": "MARKET",
  "volume": 0.01,
  "sl": 0,
  "tp": 0,
  "deviation": 20,
  "magic": 123456,
  "comment": "postman-test",
  "accountId": 1111343
}
```
**Expect:** `{ "retcode": 10009, "deal": <ticket>, "order": <ticket>, "volume": 0.01, "price": <fill_price> }`

```json
{
    "retcode": 10009,
    "deal": 97841144,
    "order": 107313410,
    "volume": 0.01,
    "price": 5020.89,
    "comment": "Request executed"
}
```

Findings:
Not sure we are able to switch profiles and take positions from other profiles. 
As long as the AlgoTrading is enabled we are able to place trades.

TODO: Add another demo account from another broker and test placing an order by switching the user

---

### 8.2 Market BUY — Gold (0.01 lots) with Stop Loss
```
POST {{baseUrl}}/order
Content-Type: application/json

{
  "symbol": "XAUUSD",
  "action": "BUY",
  "order_type": "MARKET",
  "volume": 0.01,
  "sl": 4950.00,
  "tp": 0,
  "deviation": 20,
  "magic": 123456,
  "comment": "postman-test",
  "accountId": 1111343
}
```
**Expect:** `retcode: 10009`, position appears in MT5 Trade tab

---

### 8.3 Limit SELL — Gold (0.01 lots, above current price)
```
POST {{baseUrl}}/order
Content-Type: application/json

{
  "symbol": "XAUUSD",
  "action": "SELL",
  "order_type": "LIMIT",
  "volume": 0.01,
  "price": 5050.00,
  "sl": 5070.00,
  "tp": 0,
  "deviation": 10,
  "magic": 123456,
  "comment": "postman-limit",
  "accountId": 1111343
}
```
**Expect:** `retcode: 10009`, pending order appears in MT5 Orders tab

---

### 8.4 Market SELL — EURUSD (0.01 lots)
```
POST {{baseUrl}}/order
Content-Type: application/json

{
  "symbol": "EURUSD",
  "action": "SELL",
  "order_type": "MARKET",
  "volume": 0.01,
  "sl": 0,
  "tp": 0,
  "deviation": 10,
  "magic": 123456,
  "comment": "postman-test",
  "accountId": 1111343
}
```

---

## 9. Close & Cancel

> Run these **after** placing orders in section 8. Note the `ticket` from the responses above.

### 9.1 Close a position by ticket
```
POST {{baseUrl}}/order/close
Content-Type: application/json

{
  "ticket": 123456789,
  "accountId": 1111343
}
```
**Expect:** `{ "retcode": 10009, "deal": <close_deal_ticket> }`

```json
{
    "retcode": 10009,
    "deal": 97842080,
    "order": 107314343,
    "volume": 0.01,
    "price": 5022.46,
    "comment": "Request executed"
}
```

Findings:
We dont see if we have profit or loss within the response.

In question: How do we know if this was profitable or not.

---

### 9.2 Partial close (half the volume)
```
POST {{baseUrl}}/order/close
Content-Type: application/json

{
  "ticket": 123456789,
  "volume": 0.005,
  "accountId": 1111343
}
```
**Expect:** Position still open with `volume: 0.005`

---

### 9.3 Cancel a pending limit/stop order
```
POST {{baseUrl}}/order/cancel
Content-Type: application/json

{
  "ticket": 987654321,
  "accountId": 1111343
}
```
**Expect:** `{ "retcode": 10009 }` — order removed from MT5 Orders tab

---

## 10. Error Cases (Expected Failures)

### 10.1 Invalid symbol
```
GET {{baseUrl}}/symbol-info/FAKESYMBOL
```
**Expect:** `HTTP 404` — `{ "detail": "Symbol FAKESYMBOL not found" }`

```json
{
    "detail": "Symbol FAKESYMBOL not found"
}
```
---

### 10.2 Account not authorised in terminal
```
GET {{baseUrl}}/account?accountId=1511022881
```
**Expect:** `HTTP 502` — `"Could not switch to account 1511022881. Ensure it's authorized in MT5 terminal."`

1511022881 - this is inactive accunt in FTMO
Swithing to live account (1013336511) was working as expected.

---

### 10.3 Order too small (below volume_min)
```
POST {{baseUrl}}/order
Content-Type: application/json

{
  "symbol": "XAUUSD",
  "action": "BUY",
  "order_type": "MARKET",
  "volume": 0.001,
  "accountId": 1111343
}
```
**Expect:** `HTTP 502` — `"Order rejected: 10014 — Invalid volume"`

---

### 10.4 Order when AutoTrading is disabled
Turn off AutoTrading in MT5 terminal, then:
```
POST {{baseUrl}}/order
Content-Type: application/json

{
  "symbol": "XAUUSD",
  "action": "SELL",
  "order_type": "MARKET",
  "volume": 0.01,
  "accountId": 1111343
}
```
**Expect:** `HTTP 502` — `"Order rejected: 10027 — AutoTrading disabled by client"`

---

## Quick Reference — All Endpoints

| # | Method | Path | Purpose |
|---|--------|------|---------|
| 1 | GET | `/health` | Connection + terminal + account status |
| 2 | POST | `/health/reconnect` | Re-initialise MT5 |
| 3 | GET | `/accounts` | List registered accounts |
| 4 | POST | `/accounts/register` | Register new account |
| 5 | POST | `/accounts/switch?login=X` | Switch active account |
| 6 | GET | `/symbols` | All Market Watch symbols |
| 7 | GET | `/symbols?search=XAU` | Filtered symbol search |
| 8 | GET | `/symbol-info/{symbol}` | Full symbol specification |
| 9 | GET | `/snapshot/{symbol}` | Full market data (price+candles+account) |
| 10 | GET | `/candles/{symbol}?timeframe=M15&count=100` | Single-timeframe OHLCV |
| 11 | GET | `/orderbook/{symbol}?depth=20` | Market depth (DOM) |
| 12 | GET | `/trades/{symbol}?count=50` | Recent tick tape |
| 13 | GET | `/account` | Account balance/equity/margin |
| 14 | GET | `/positions` | All open positions |
| 15 | GET | `/positions?symbol=XAUUSD` | Positions for one symbol |
| 16 | GET | `/orders` | All pending orders |
| 17 | GET | `/orders?symbol=XAUUSD` | Pending orders for symbol |
| 18 | GET | `/history/deals?days=7&limit=50` | Closed trade history |
| 19 | POST | `/order` | Place market or limit order |
| 20 | POST | `/order/close` | Close open position (full or partial) |
| 21 | POST | `/order/cancel` | Cancel pending order |

---

## Postman Setup Tips

1. **Create a Collection** called "Wolf-Fin MT5 Bridge"
2. **Set a collection variable** `baseUrl = http://127.0.0.1:8000`
3. **Set an environment variable** `accountId = 1111343` (swap for other accounts as needed)
4. **Run in order**: Health → Accounts → Symbols → Snapshot → Place Order → Check Positions → Close → Check History
5. **Save the `ticket`** from each order response — you need it for close/cancel calls

### Recommended test flow (full end-to-end):
1. `GET /health` — confirm connected
2. `GET /symbol-info/XAUUSD?accountId=1111343` — confirm `trade_mode: 4`
3. `GET /snapshot/XAUUSD?accountId=1111343` — note current bid/ask
4. `GET /positions?accountId=1111343` — confirm empty
5. `POST /order` (SELL MARKET 0.01) — **save the `order` ticket**
6. `GET /positions?accountId=1111343` — confirm position opened
7. `GET /history/deals?days=1&accountId=1111343` — confirm entry deal
8. `POST /order/close` (ticket from step 5)
9. `GET /positions?accountId=1111343` — confirm empty again
10. `GET /history/deals?days=1&accountId=1111343` — confirm exit deal + profit
