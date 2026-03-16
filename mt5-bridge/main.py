"""
Wolf-Fin MT5 Bridge — FastAPI microservice wrapping the official MetaTrader5 Python package.
Exposes REST endpoints for market data, account info, and order execution.
The Node.js MT5Adapter calls this over localhost HTTP.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import MetaTrader5 as mt5
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Wolf-Fin MT5 Bridge", version="1.0.0")

connected: bool = False
ACCOUNTS_CONFIG = Path("mt5_accounts.json")


def load_accounts_config() -> dict:
    """Load registered MT5 accounts from config file."""
    if ACCOUNTS_CONFIG.exists():
        with open(ACCOUNTS_CONFIG) as f:
            return json.load(f)
    return {"accounts": []}


def save_accounts_config(config: dict) -> None:
    """Save registered MT5 accounts to config file."""
    with open(ACCOUNTS_CONFIG, "w") as f:
        json.dump(config, f, indent=2)


# ── Lifecycle ─────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup() -> None:
    global connected
    if mt5.initialize():
        connected = True
        info = mt5.account_info()
        if info:
            print(f"[mt5-bridge] Connected — login {info.login} on {info.server}")
    else:
        connected = False
        code, msg = mt5.last_error()
        print(f"[mt5-bridge] Failed to initialize MT5: {code} — {msg}")


@app.on_event("shutdown")
def shutdown() -> None:
    mt5.shutdown()
    print("[mt5-bridge] MT5 shutdown")


def require_connected() -> None:
    if not connected:
        raise HTTPException(503, detail="MT5 terminal not connected")


def ensure_account(account_id: Optional[int] = None) -> None:
    """Switch to account_id if provided, else use current account."""
    if account_id is None:
        return
    require_connected()
    # Try to login with empty password (account must be authorized in terminal)
    if not mt5.login(account_id, "", ""):
        # Try to infer server from accounts config
        config = load_accounts_config()
        acc = next((a for a in config.get("accounts", []) if a["login"] == account_id), None)
        if acc:
            if not mt5.login(account_id, "", acc["server"]):
                raise HTTPException(502, detail=f"Could not switch to account {account_id}. Ensure it's authorized in MT5 terminal.")
        else:
            raise HTTPException(404, detail=f"Account {account_id} not found in config")


# ── Symbol helpers ────────────────────────────────────────────────────────────

# Optional broker-specific suffix mapping.  If your broker appends a suffix
# (e.g. "EURUSDm", "EURUSD."), add entries here.
SYMBOL_MAP: dict[str, str] = {
    # ── Equiti STP/SD account — broker appends .sd suffix ──────────────────
    "BTCUSD": "BTCUSD.lv",
    "EURUSD":  "EURUSD",
    "GBPUSD":  "GBPUSD",
    "USDJPY":  "USDJPY.sd",
    "USDCHF":  "USDCHF.sd",
    "AUDUSD":  "AUDUSD.sd",
    "NZDUSD":  "NZDUSD.sd",
    "USDCAD":  "USDCAD.sd",
    "EURGBP":  "EURGBP.sd",
    "EURJPY":  "EURJPY.sd",
    "GBPJPY":  "GBPJPY.sd",
    "XAUUSD":  "XAUUSD.sd",   # Gold vs USD
    "XAGUSD":  "XAGUSD.sd",   # Silver vs USD
    "XAUUSD.SD": "XAUUSD.sd", # normalise case variants
    # ── Add non-.sd broker symbols below if needed ─────────────────────────
    # "BTCUSD": "BTCUSD",
}


def normalize_symbol(symbol: str) -> str:
    """Convert wolf-fin format (EUR_USD) to MT5 format (EURUSD)."""
    clean = symbol.upper().replace("_", "")
    return SYMBOL_MAP.get(clean, clean)


def to_wolfin_symbol(symbol: str) -> str:
    """Convert MT5 format (EURUSD) back to wolf-fin format (EUR_USD)."""
    # Strip any broker suffix first
    for wf, mt in SYMBOL_MAP.items():
        if symbol == mt:
            symbol = wf
            break
    s = symbol.upper()
    if len(s) == 6 and s.isalpha():
        return f"{s[:3]}_{s[3:]}"
    return s


# ── Candle mapper ─────────────────────────────────────────────────────────────

def map_candle(rate: Any) -> dict:
    """Map a numpy structured array row to a JSON-serialisable dict."""
    return {
        "openTime": int(rate["time"]) * 1000,
        "open": float(rate["open"]),
        "high": float(rate["high"]),
        "low": float(rate["low"]),
        "close": float(rate["close"]),
        "volume": float(rate["tick_volume"]),
        "closeTime": int(rate["time"]) * 1000 + 60_000,  # approximate
    }


# ── Position / order mappers ─────────────────────────────────────────────────

def map_position(pos: Any) -> dict:
    return {
        "ticket": pos.ticket,
        "symbol": to_wolfin_symbol(pos.symbol),
        "side": "BUY" if pos.type == 0 else "SELL",
        "volume": pos.volume,
        "priceOpen": pos.price_open,
        "priceCurrent": pos.price_current,
        "profit": pos.profit,
        "swap": pos.swap,
        "sl": pos.sl,
        "tp": pos.tp,
        "magic": pos.magic,
        "comment": pos.comment,
        "time": datetime.fromtimestamp(pos.time, tz=timezone.utc).isoformat(),
    }


def map_deal(deal: Any) -> dict:
    return {
        "ticket": deal.ticket,
        "order": deal.order,
        "symbol": to_wolfin_symbol(deal.symbol),
        "type": deal.type,  # 0=BUY, 1=SELL
        "volume": deal.volume,
        "price": deal.price,
        "profit": deal.profit,
        "commission": deal.commission,
        "swap": deal.swap,
        "fee": deal.fee,
        "magic": deal.magic,
        "comment": deal.comment,
        "time": datetime.fromtimestamp(deal.time, tz=timezone.utc).isoformat(),
    }


def map_order(order: Any) -> dict:
    return {
        "ticket": order.ticket,
        "symbol": to_wolfin_symbol(order.symbol),
        "type": order.type,
        "volume_initial": order.volume_initial,
        "volume_current": order.volume_current,
        "price_open": order.price_open,
        "sl": order.sl,
        "tp": order.tp,
        "price_current": order.price_current,
        "state": order.state,
        "magic": order.magic,
        "comment": order.comment,
        "time": datetime.fromtimestamp(order.time_setup, tz=timezone.utc).isoformat(),
    }


# ── Symbols list ─────────────────────────────────────────────────────────────

@app.get("/symbols")
def list_symbols(search: Optional[str] = None) -> list[dict]:
    """List all symbols available in Market Watch (or matching a search string)."""
    require_connected()
    if search:
        symbols = mt5.symbols_get(search)
    else:
        symbols = mt5.symbols_get()
    if symbols is None:
        return []
    return [
        {
            "name": s.name,
            "description": s.description,
            "path": s.path,
            "visible": s.visible,
            "trade_mode": s.trade_mode,
        }
        for s in symbols
    ]


# ── Account management ────────────────────────────────────────────────────────

@app.get("/accounts")
def list_accounts() -> dict:
    """List all registered MT5 accounts. Shows which is currently active."""
    require_connected()
    config = load_accounts_config()
    current = mt5.account_info()
    current_login = current.login if current else None

    return {
        "current_login": current_login,
        "accounts": config.get("accounts", [])
    }


class RegisterAccountRequest(BaseModel):
    login: int
    password: str
    server: str
    name: str  # friendly name (e.g., "EUR Live", "FTMO Demo")


@app.post("/accounts/register")
def register_account(req: RegisterAccountRequest) -> dict:
    """Register an MT5 account. Tests login validity."""
    require_connected()

    # Test if credentials work
    if not mt5.login(req.login, req.password, req.server):
        raise HTTPException(400, detail="Invalid login credentials")

    config = load_accounts_config()
    # Check if already registered
    for acc in config.get("accounts", []):
        if acc["login"] == req.login:
            return {"message": f"Account {req.login} already registered"}

    config.setdefault("accounts", []).append({
        "login": req.login,
        "server": req.server,
        "name": req.name,
        "registered_at": datetime.now(tz=timezone.utc).isoformat()
    })
    save_accounts_config(config)

    return {"message": f"Account {req.login} registered", "accounts": config["accounts"]}


@app.post("/accounts/switch")
def switch_account(login: int = Query(..., description="Account login ID")) -> dict:
    """Switch to a registered account. Account must be loaded in MT5 terminal."""
    require_connected()
    config = load_accounts_config()

    # Find account in config
    acc = next((a for a in config.get("accounts", []) if a["login"] == login), None)
    if not acc:
        raise HTTPException(404, detail=f"Account {login} not registered. Use POST /accounts/register first.")

    # Try to login
    if not mt5.login(login, "", acc["server"]):  # Empty password — account must already be authorized in terminal
        raise HTTPException(502, detail=f"Could not switch to account {login}. Ensure it's authorized in MT5 terminal.")

    return {"message": f"Switched to account {login}", "name": acc["name"]}


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    result: dict[str, Any] = {"connected": connected}
    if connected:
        ti = mt5.terminal_info()
        ai = mt5.account_info()
        if ti:
            result["terminal"] = {"build": ti.build, "connected": ti.connected}
        if ai:
            result["account"] = {
                "login": ai.login,
                "server": ai.server,
                "trade_mode": ai.trade_mode,  # 0=demo, 1=contest, 2=real
                "leverage": ai.leverage,
                "balance": ai.balance,
            }
    return result


@app.post("/health/reconnect")
def reconnect() -> dict:
    global connected
    mt5.shutdown()
    if mt5.initialize():
        connected = True
        return {"connected": True}
    else:
        connected = False
        code, msg = mt5.last_error()
        raise HTTPException(502, detail=f"Reconnect failed: {code} — {msg}")


# ── Snapshot (workhorse endpoint) ─────────────────────────────────────────────

@app.get("/snapshot/{symbol}")
def get_snapshot(symbol: str, accountId: Optional[int] = None) -> dict:
    require_connected()
    ensure_account(accountId)
    mt5_sym = normalize_symbol(symbol)

    # Ensure symbol is available
    if not mt5.symbol_select(mt5_sym, True):
        raise HTTPException(404, detail=f"Symbol {mt5_sym} not found or cannot be selected")

    # Tick
    tick = mt5.symbol_info_tick(mt5_sym)
    if tick is None:
        raise HTTPException(502, detail=f"No tick data for {mt5_sym}")

    # Symbol info
    info = mt5.symbol_info(mt5_sym)
    if info is None:
        raise HTTPException(502, detail=f"No symbol info for {mt5_sym}")

    # Account
    acct = mt5.account_info()

    # Positions for this symbol
    positions = mt5.positions_get(symbol=mt5_sym)
    pos_list = [map_position(p) for p in positions] if positions else []

    # Candles — 4 timeframes
    timeframes = {
        "m1": mt5.TIMEFRAME_M1,
        "m15": mt5.TIMEFRAME_M15,
        "h1": mt5.TIMEFRAME_H1,
        "h4": mt5.TIMEFRAME_H4,
    }
    candles: dict[str, list] = {}
    for label, tf in timeframes.items():
        rates = mt5.copy_rates_from_pos(mt5_sym, tf, 0, 100)
        candles[label] = [map_candle(r) for r in rates] if rates is not None else []

    return {
        "symbol": to_wolfin_symbol(mt5_sym),
        "price": {
            "bid": tick.bid,
            "ask": tick.ask,
            "last": tick.last if tick.last != 0 else (tick.bid + tick.ask) / 2,
        },
        "candles": candles,
        "symbol_info": {
            "spread": info.spread,
            "point": info.point,
            "digits": info.digits,
            "swap_long": info.swap_long,
            "swap_short": info.swap_short,
            "trade_mode": info.trade_mode,
            "volume_min": info.volume_min,
            "volume_max": info.volume_max,
            "volume_step": info.volume_step,
            "trade_contract_size": info.trade_contract_size,
            "session_open": info.trade_mode > 0,  # 0=disabled, 1=longonly, 2=shortonly, 3=closeonly, 4=full
        },
        "account": {
            "balance": acct.balance if acct else 0,
            "equity": acct.equity if acct else 0,
            "margin": acct.margin if acct else 0,
            "free_margin": acct.margin_free if acct else 0,
            "profit": acct.profit if acct else 0,
            "leverage": acct.leverage if acct else 0,
            "login": acct.login if acct else 0,
            "server": acct.server if acct else "",
        },
        "positions": pos_list,
    }


# ── Candles (single timeframe) ───────────────────────────────────────────────

TIMEFRAME_MAP = {
    "M1": mt5.TIMEFRAME_M1,
    "M5": mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30,
    "H1": mt5.TIMEFRAME_H1,
    "H4": mt5.TIMEFRAME_H4,
    "D1": mt5.TIMEFRAME_D1,
    "W1": mt5.TIMEFRAME_W1,
    "MN1": mt5.TIMEFRAME_MN1,
}


@app.get("/candles/{symbol}")
def get_candles(
    symbol: str,
    timeframe: str = Query("M15", description="MT5 timeframe: M1, M5, M15, M30, H1, H4, D1, W1, MN1"),
    count: int = Query(100, ge=1, le=1000),
    accountId: Optional[int] = None,
) -> dict:
    require_connected()
    ensure_account(accountId)
    mt5_sym = normalize_symbol(symbol)
    mt5.symbol_select(mt5_sym, True)

    tf = TIMEFRAME_MAP.get(timeframe.upper())
    if tf is None:
        raise HTTPException(400, detail=f"Invalid timeframe: {timeframe}")

    rates = mt5.copy_rates_from_pos(mt5_sym, tf, 0, count)
    if rates is None:
        code, msg = mt5.last_error()
        raise HTTPException(502, detail=f"Failed to fetch candles: {code} — {msg}")

    return {
        "symbol": to_wolfin_symbol(mt5_sym),
        "timeframe": timeframe.upper(),
        "candles": [map_candle(r) for r in rates],
    }


# ── Order book (market depth) ────────────────────────────────────────────────

@app.get("/orderbook/{symbol}")
def get_orderbook(symbol: str, depth: int = Query(20, ge=1, le=50), accountId: Optional[int] = None) -> dict:
    require_connected()
    ensure_account(accountId)
    mt5_sym = normalize_symbol(symbol)
    mt5.symbol_select(mt5_sym, True)

    # Subscribe to market depth
    if not mt5.market_book_add(mt5_sym):
        raise HTTPException(502, detail=f"Cannot subscribe to market depth for {mt5_sym}")

    book = mt5.market_book_get(mt5_sym)
    # Unsubscribe
    mt5.market_book_release(mt5_sym)

    if book is None:
        return {"symbol": to_wolfin_symbol(mt5_sym), "bids": [], "asks": [], "timestamp": int(time.time() * 1000)}

    bids: list[list[float]] = []
    asks: list[list[float]] = []
    for item in book:
        entry = [item.price, item.volume]
        if item.type == mt5.BOOK_TYPE_SELL or item.type == mt5.BOOK_TYPE_SELL_MARKET:
            asks.append(entry)
        else:
            bids.append(entry)

    # Limit to requested depth
    bids = bids[:depth]
    asks = asks[:depth]

    return {
        "symbol": to_wolfin_symbol(mt5_sym),
        "bids": bids,
        "asks": asks,
        "timestamp": int(time.time() * 1000),
    }


# ── Recent trades (ticks) ────────────────────────────────────────────────────

@app.get("/trades/{symbol}")
def get_recent_trades(symbol: str, count: int = Query(50, ge=1, le=500), accountId: Optional[int] = None) -> dict:
    require_connected()
    ensure_account(accountId)
    mt5_sym = normalize_symbol(symbol)
    mt5.symbol_select(mt5_sym, True)

    ticks = mt5.copy_ticks_from_pos(mt5_sym, 0, count, mt5.COPY_TICKS_TRADE)
    if ticks is None:
        return {"symbol": to_wolfin_symbol(mt5_sym), "trades": []}

    trades = []
    for t in ticks:
        trades.append({
            "price": float(t["bid"] if t["flags"] & 2 else t["ask"]),  # approximate
            "volume": float(t["volume"]) if "volume" in t.dtype.names else 0,
            "time": int(t["time_msc"]) if "time_msc" in t.dtype.names else int(t["time"]) * 1000,
            "isBuyerMaker": bool(t["flags"] & 2),  # TICK_FLAG_SELL
        })

    return {"symbol": to_wolfin_symbol(mt5_sym), "trades": trades}


# ── Account ───────────────────────────────────────────────────────────────────

@app.get("/account")
def get_account(accountId: Optional[int] = None) -> dict:
    require_connected()
    ensure_account(accountId)
    acct = mt5.account_info()
    if acct is None:
        raise HTTPException(502, detail="Cannot fetch account info")
    return {
        "login": acct.login,
        "server": acct.server,
        "trade_mode": acct.trade_mode,
        "balance": acct.balance,
        "equity": acct.equity,
        "margin": acct.margin,
        "free_margin": acct.margin_free,
        "profit": acct.profit,
        "leverage": acct.leverage,
        "currency": acct.currency,
        "name": acct.name,
        "company": acct.company,
    }


# ── Positions ─────────────────────────────────────────────────────────────────

@app.get("/positions")
def get_positions(symbol: Optional[str] = None, accountId: Optional[int] = None) -> list[dict]:
    require_connected()
    ensure_account(accountId)
    if symbol:
        mt5_sym = normalize_symbol(symbol)
        positions = mt5.positions_get(symbol=mt5_sym)
    else:
        positions = mt5.positions_get()
    if positions is None:
        return []
    return [map_position(p) for p in positions]


# ── Pending orders ────────────────────────────────────────────────────────────

@app.get("/orders")
def get_orders(symbol: Optional[str] = None, accountId: Optional[int] = None) -> list[dict]:
    require_connected()
    ensure_account(accountId)
    if symbol:
        mt5_sym = normalize_symbol(symbol)
        orders = mt5.orders_get(symbol=mt5_sym)
    else:
        orders = mt5.orders_get()
    if orders is None:
        return []
    return [map_order(o) for o in orders]


# ── Trade history (deals) ────────────────────────────────────────────────────

@app.get("/history/deals")
def get_history_deals(
    symbol: Optional[str] = None,
    days: int = Query(7, ge=1, le=90),
    limit: int = Query(50, ge=1, le=500),
    accountId: Optional[int] = None,
) -> list[dict]:
    require_connected()
    ensure_account(accountId)
    date_to = datetime.now(tz=timezone.utc)
    date_from = date_to - timedelta(days=days)

    if symbol:
        mt5_sym = normalize_symbol(symbol)
        deals = mt5.history_deals_get(date_from, date_to, group=f"*{mt5_sym}*")
    else:
        deals = mt5.history_deals_get(date_from, date_to)

    if deals is None:
        return []

    # Return most recent first, limited
    mapped = [map_deal(d) for d in deals]
    mapped.reverse()
    return mapped[:limit]


# ── Symbol info ───────────────────────────────────────────────────────────────

@app.get("/symbol-info/{symbol}")
def get_symbol_info(symbol: str, accountId: Optional[int] = None) -> dict:
    require_connected()
    ensure_account(accountId)
    mt5_sym = normalize_symbol(symbol)
    mt5.symbol_select(mt5_sym, True)

    info = mt5.symbol_info(mt5_sym)
    if info is None:
        raise HTTPException(404, detail=f"Symbol {mt5_sym} not found")

    return {
        "symbol": to_wolfin_symbol(mt5_sym),
        "point": info.point,
        "digits": info.digits,
        "spread": info.spread,
        "spread_float": info.spread * info.point,
        "swap_long": info.swap_long,
        "swap_short": info.swap_short,
        "trade_mode": info.trade_mode,
        "trade_contract_size": info.trade_contract_size,
        "volume_min": info.volume_min,
        "volume_max": info.volume_max,
        "volume_step": info.volume_step,
        "currency_base": info.currency_base,
        "currency_profit": info.currency_profit,
        "currency_margin": info.currency_margin,
        "description": info.description,
    }


# ── Place order ───────────────────────────────────────────────────────────────

class OrderRequest(BaseModel):
    symbol: str
    action: str  # BUY or SELL
    order_type: str = "MARKET"  # MARKET, LIMIT, STOP
    volume: float
    price: Optional[float] = None
    sl: Optional[float] = None
    tp: Optional[float] = None
    deviation: int = 10
    magic: int = 123456
    comment: str = "wolf-fin"
    accountId: Optional[int] = None  # NEW: specify account


ORDER_TYPE_MAP = {
    ("BUY", "MARKET"): mt5.ORDER_TYPE_BUY,
    ("SELL", "MARKET"): mt5.ORDER_TYPE_SELL,
    ("BUY", "LIMIT"): mt5.ORDER_TYPE_BUY_LIMIT,
    ("SELL", "LIMIT"): mt5.ORDER_TYPE_SELL_LIMIT,
    ("BUY", "STOP"): mt5.ORDER_TYPE_BUY_STOP,
    ("SELL", "STOP"): mt5.ORDER_TYPE_SELL_STOP,
}


@app.post("/order")
def place_order(req: OrderRequest) -> dict:
    require_connected()
    ensure_account(req.accountId)
    mt5_sym = normalize_symbol(req.symbol)
    mt5.symbol_select(mt5_sym, True)

    order_type = ORDER_TYPE_MAP.get((req.action.upper(), req.order_type.upper()))
    if order_type is None:
        raise HTTPException(400, detail=f"Invalid action/type combo: {req.action}/{req.order_type}")

    # Get current price if not provided
    tick = mt5.symbol_info_tick(mt5_sym)
    if tick is None:
        raise HTTPException(502, detail=f"No tick for {mt5_sym}")

    price = req.price
    if price is None:
        price = tick.ask if req.action.upper() == "BUY" else tick.bid

    # Determine trade action
    if req.order_type.upper() == "MARKET":
        trade_action = mt5.TRADE_ACTION_DEAL
    else:
        trade_action = mt5.TRADE_ACTION_PENDING

    request: dict[str, Any] = {
        "action": trade_action,
        "symbol": mt5_sym,
        "volume": req.volume,
        "type": order_type,
        "price": price,
        "deviation": req.deviation,
        "magic": req.magic,
        "comment": req.comment,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    if req.sl is not None and req.sl > 0:
        request["sl"] = req.sl
    if req.tp is not None and req.tp > 0:
        request["tp"] = req.tp

    result = mt5.order_send(request)
    if result is None:
        code, msg = mt5.last_error()
        raise HTTPException(502, detail=f"order_send failed: {code} — {msg}")

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        raise HTTPException(502, detail=f"Order rejected: {result.retcode} — {result.comment}")

    return {
        "retcode": result.retcode,
        "deal": result.deal,
        "order": result.order,
        "volume": result.volume,
        "price": result.price,
        "comment": result.comment,
    }


# ── Close position ────────────────────────────────────────────────────────────

class CloseRequest(BaseModel):
    ticket: int
    volume: Optional[float] = None  # partial close; None = close full
    accountId: Optional[int] = None


@app.post("/order/close")
def close_position(req: CloseRequest) -> dict:
    require_connected()
    ensure_account(req.accountId)

    # Find the position
    positions = mt5.positions_get(ticket=req.ticket)
    if not positions or len(positions) == 0:
        raise HTTPException(404, detail=f"Position {req.ticket} not found")

    pos = positions[0]
    mt5_sym = pos.symbol
    close_volume = req.volume if req.volume else pos.volume

    # Reverse the position direction
    close_type = mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY
    tick = mt5.symbol_info_tick(mt5_sym)
    if tick is None:
        raise HTTPException(502, detail=f"No tick for {mt5_sym}")

    price = tick.bid if pos.type == 0 else tick.ask

    request: dict[str, Any] = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": mt5_sym,
        "volume": close_volume,
        "type": close_type,
        "position": req.ticket,
        "price": price,
        "deviation": 10,
        "magic": pos.magic,
        "comment": "wolf-fin close",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request)
    if result is None:
        code, msg = mt5.last_error()
        raise HTTPException(502, detail=f"Close failed: {code} — {msg}")

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        raise HTTPException(502, detail=f"Close rejected: {result.retcode} — {result.comment}")

    return {
        "retcode": result.retcode,
        "deal": result.deal,
        "order": result.order,
        "volume": result.volume,
        "price": result.price,
        "comment": result.comment,
    }


# ── Cancel pending order ─────────────────────────────────────────────────────

class CancelRequest(BaseModel):
    ticket: int
    accountId: Optional[int] = None


@app.post("/order/cancel")
def cancel_order(req: CancelRequest) -> dict:
    require_connected()
    ensure_account(req.accountId)

    request: dict[str, Any] = {
        "action": mt5.TRADE_ACTION_REMOVE,
        "order": req.ticket,
    }

    result = mt5.order_send(request)
    if result is None:
        code, msg = mt5.last_error()
        raise HTTPException(502, detail=f"Cancel failed: {code} — {msg}")

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        raise HTTPException(502, detail=f"Cancel rejected: {result.retcode} — {result.comment}")

    return {"retcode": result.retcode, "comment": result.comment}
