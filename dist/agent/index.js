// Wolf-Fin Agent — session-based tick architecture
// One conversation session per day. Each scheduled interval fires one "tick"
// (a new message turn) appended to the same ongoing conversation, so the LLM
// remembers every decision it made earlier in the session.
import pino from 'pino';
import { getLLMProvider, getModelForConfig } from '../llm/index.js';
import { RateLimitError } from '../llm/openrouter.js';
import { getAdapter } from '../adapters/registry.js';
import { getRiskState } from '../guardrails/riskState.js';
import { updatePositionNotionalFor, setMt5Context, getRiskStateFor } from '../guardrails/riskStateStore.js';
import { validateOrder } from '../guardrails/validate.js';
import { validateMt5Order } from '../guardrails/mt5.js';
import { getMt5Context } from '../guardrails/riskStateStore.js';
import { buildMarketContext } from './context.js';
import { sessionLabel, minutesUntilSessionClose } from '../adapters/session.js';
import { fetchForexNews } from '../adapters/finnhubNews.js';
import { runMonteCarlo, formatMCBlock } from '../adapters/montecarlo.js';
import { getTools } from '../tools/definitions.js';
import { recordCycle, logEvent, tryAcquireCycleLock, releaseCycleLock, getAgent, setAgentStatus, setAgentPaused, consumePlanRequest } from '../server/state.js';
import { dbGetAgentPerformance, makeAgentKey, dbSaveMemory, dbGetMemories, dbDeleteMemory, dbSavePlan, dbGetActivePlan, dbGetStrategy, dbGetTodaySession, dbSaveSession, dbGetPreviousSession, } from '../db/index.js';
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const activeSessions = new Map();
function todayDate() {
    return new Date().toISOString().slice(0, 10);
}
function loadOrCreateSession(agentKey) {
    const today = todayDate();
    const cached = activeSessions.get(agentKey);
    if (cached && cached.sessionDate === today) {
        return { session: cached, isNew: false };
    }
    // New day or not in memory — try DB
    const persisted = dbGetTodaySession(agentKey);
    if (persisted && persisted.sessionDate === today) {
        const session = {
            sessionDate: today,
            messages: persisted.messages,
            tickCount: persisted.tickCount,
            summary: persisted.summary,
        };
        activeSessions.set(agentKey, session);
        return { session, isNew: false };
    }
    // Brand new session — auto-summarise the previous session into persistent memory
    autoSummarisePreviousSession(agentKey);
    const session = { sessionDate: today, messages: [], tickCount: 0, summary: null };
    activeSessions.set(agentKey, session);
    return { session, isNew: true };
}
/**
 * When a new session starts, compress the previous day's session into a persistent
 * agent_memory entry (category='session') so context survives across session resets.
 * The memory is automatically injected into the system prompt via dbGetMemories().
 */
function autoSummarisePreviousSession(agentKey) {
    try {
        const prev = dbGetPreviousSession(agentKey);
        if (!prev || prev.tickCount === 0)
            return;
        // Idempotent — skip if already saved
        const memKey = `session_${prev.sessionDate}`;
        const existing = dbGetMemories(agentKey, 'session', 100).find(m => m.key === memKey);
        if (existing)
            return;
        // Compress the recent messages not yet in summary
        const recentCompressed = compressToSummary(prev.messages);
        const parts = [`[${prev.sessionDate}] — ${prev.tickCount} ticks`];
        if (prev.summary)
            parts.push(prev.summary);
        if (recentCompressed && recentCompressed !== '(no decisions recorded)')
            parts.push(recentCompressed);
        const value = parts.join('\n');
        // Keep 14 days of session history
        dbSaveMemory(agentKey, 'session', memKey, value, 0.9, 14 * 24);
        log.info({ agentKey, sessionDate: prev.sessionDate }, 'cross-session memory saved');
    }
    catch (err) {
        log.warn({ agentKey, err }, 'autoSummarisePreviousSession failed — skipping');
    }
}
// ── Per-agent peak equity tracker — used for drawdown auto-pause ──────────────
const peakEquityByAgent = new Map();
const lastKnownPositions = new Map();
// ── Per-agent suggested lot size (computed each tick, used as guardrail clamp) ──
const suggestedLotsByAgent = new Map();
async function detectExternalCloses(agentKey, config, currentPositions, agentClosedThisTick = new Set()) {
    const prev = lastKnownPositions.get(agentKey) ?? new Map();
    const current = new Map(currentPositions.map(p => [p.ticket, p]));
    lastKnownPositions.set(agentKey, current);
    const closed = [...prev.entries()].filter(([ticket]) => !current.has(ticket) && !agentClosedThisTick.has(ticket));
    if (closed.length === 0)
        return '';
    const notes = [];
    const bridge = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`;
    const acctParam = config.mt5AccountId ? `&accountId=${config.mt5AccountId}` : '';
    for (const [ticket, pos] of closed) {
        let pnl = null;
        try {
            const deals = await fetch(`${bridge}/history/deals?symbol=${config.symbol}&days=1${acctParam}`).then(r => r.json());
            const deal = deals.find(d => d.order === ticket);
            if (deal)
                pnl = deal.profit;
        }
        catch { /* best-effort */ }
        const pnlStr = pnl !== null ? ` P&L: $${pnl.toFixed(2)}.` : '';
        logEvent(agentKey, 'warn', 'decision', `EXTERNAL_CLOSE: Position #${ticket} (${pos.side} ${pos.volume} lot @ ${pos.priceOpen}) closed externally.${pnlStr}`);
        recordCycle(agentKey, {
            symbol: config.symbol, market: config.market, paper: false,
            decision: 'EXTERNAL_CLOSE',
            reason: `Position #${ticket} (${pos.side} ${pos.volume} @ ${pos.priceOpen}) closed externally.${pnlStr}`,
            time: new Date().toISOString(),
            ...(pnl !== null ? { pnlUsd: pnl } : {}),
        });
        notes.push(`Position #${ticket} (${pos.side} ${pos.volume} lot @ ${pos.priceOpen}) was closed externally since last tick.${pnlStr}`);
    }
    return notes.join('\n');
}
/** Pip size for stop-price calculation — commodity-aware */
function pipSize(symbol, point) {
    const s = symbol.toUpperCase();
    if (s.startsWith('XAU') || s.startsWith('XAG') || s.startsWith('XPT') || s.startsWith('XPD') ||
        s.includes('OIL') || s.includes('GAS') || s.includes('GOLD') || s.includes('SILVER')) {
        return point ?? 0.01;
    }
    if (s.includes('JPY'))
        return 0.01;
    return 0.0001;
}
// ── Snapshot summary formatter (for subsequent tick messages) ─────────────────
// Detect appropriate decimal places from the magnitude of price.
// forex (EURUSD ~1.15) → 5dp | JPY-pairs (~150) → 3dp | metals/crypto (~4900) → 2dp
function priceDp(p) {
    if (p == null || p === 0)
        return 5;
    if (p >= 100)
        return 2;
    if (p >= 10)
        return 3;
    return 5;
}
// Show ATR in both raw and pip-equivalent so the agent understands scale.
function formatAtr(atr, dp, pipSize) {
    const ps = pipSize ?? (dp >= 4 ? 0.0001 : 0.01);
    const pips = atr / ps;
    return `${atr.toFixed(dp)} (${pips.toFixed(1)} pips)`;
}
function candleTrendLine(candles, count, dp) {
    const bars = candles.slice(-count);
    return bars.map(c => `${c.close.toFixed(dp)}${c.close >= c.open ? '▲' : '▼'}`).join(' ');
}
function formatSnapshotSummary(snap, agentKey, config, mc) {
    const price = snap.price;
    const indicators = snap.indicators;
    const forex = snap.forex;
    const candles = snap.candles;
    const positions = snap.positions;
    const pendingOrders = snap.pendingOrders;
    const recentDeals = snap.recentDeals;
    const accountInfo = snap.accountInfo;
    // Determine decimal precision from the current price
    const dp = priceDp(price?.last ?? 0);
    const lines = [];
    // ── Account health ──────────────────────────────────────────────────────────
    if (accountInfo?.equity != null) {
        const lev = accountInfo.leverage ? `1:${accountInfo.leverage}` : '?';
        const usedM = accountInfo.usedMargin ?? 0;
        const marginLvl = usedM > 0 ? `${(accountInfo.equity / usedM * 100).toFixed(0)}%` : '∞';
        const totalFloat = positions?.reduce((s, p) => s + p.profit, 0) ?? 0;
        const floatStr = totalFloat !== 0 ? ` | Float P&L: ${totalFloat >= 0 ? '+' : ''}$${totalFloat.toFixed(2)}` : '';
        lines.push(`Account: Balance $${accountInfo.balance?.toFixed(2) ?? '?'} | Equity $${accountInfo.equity.toFixed(2)} | Free Margin $${accountInfo.freeMargin?.toFixed(2) ?? '?'} | Used $${usedM.toFixed(2)} | Margin Level ${marginLvl} | Leverage ${lev}${floatStr}`);
    }
    if (price) {
        const stats24h = snap.stats24h;
        const rangePart = (stats24h?.high != null && stats24h?.low != null)
            ? ` | Day Range: ${stats24h.low.toFixed(dp)} – ${stats24h.high.toFixed(dp)}`
            : '';
        const chgPart = stats24h?.changePercent != null
            ? ` | 24h Chg: ${stats24h.changePercent >= 0 ? '+' : ''}${stats24h.changePercent.toFixed(2)}%`
            : '';
        lines.push(`Price: ${price.last?.toFixed(dp)} | Bid: ${price.bid?.toFixed(dp)} | Ask: ${price.ask?.toFixed(dp)}${rangePart}${chgPart}`);
    }
    // ── Daily risk budget ───────────────────────────────────────────────────────
    const risk = snap.risk;
    if (risk != null) {
        const pnlStr = risk.dailyPnlUsd != null
            ? `Today P&L: ${risk.dailyPnlUsd >= 0 ? '+' : ''}$${risk.dailyPnlUsd.toFixed(2)}`
            : '';
        const budgStr = risk.remainingBudgetUsd != null
            ? `Remaining budget: $${risk.remainingBudgetUsd.toFixed(2)}`
            : '';
        const notStr = risk.positionNotionalUsd != null && risk.positionNotionalUsd > 0
            ? `Notional exposed: $${risk.positionNotionalUsd.toFixed(2)}`
            : '';
        const parts = [pnlStr, budgStr, notStr].filter(Boolean);
        if (parts.length > 0)
            lines.push(`Risk Budget: ${parts.join(' | ')}`);
    }
    if (forex) {
        // Show spread in both points and price-equivalent to avoid model confusion
        const spreadPoints = forex.spread ?? 0;
        const spreadPrice = forex.point != null ? spreadPoints * forex.point : 0;
        const atrPrice = indicators?.atr14 ?? 0;
        const spreadPctOfAtr = atrPrice > 0 ? (spreadPrice / atrPrice * 100) : 0;
        const spreadVerdict = spreadPctOfAtr <= 5 ? '✅ TIGHT' : spreadPctOfAtr <= 20 ? '⚠️ OK' : '❌ WIDE';
        const spreadLabel = dp >= 4
            ? `${(spreadPoints / 10).toFixed(1)} pips ($${spreadPrice.toFixed(4)})`
            : `${spreadPoints} points ($${spreadPrice.toFixed(2)})`;
        const swapStr = (forex.swapLong != null || forex.swapShort != null)
            ? ` | Swap Long/Short: ${forex.swapLong?.toFixed(2) ?? '?'}/${forex.swapShort?.toFixed(2) ?? '?'} $/lot/night`
            : '';
        lines.push(`Spread: ${spreadLabel} = ${spreadPctOfAtr.toFixed(1)}% of ATR → ${spreadVerdict} | Session: ${forex.sessionOpen ? 'OPEN' : 'CLOSED'}${swapStr}`);
    }
    // ── Indicators with inline interpretation labels ────────────────────────────
    if (indicators) {
        const trendLabel = (indicators.ema20 != null && indicators.ema50 != null)
            ? indicators.ema20 > indicators.ema50 ? '▲ BULLISH TREND' : '▼ BEARISH TREND'
            : '';
        const rsiLabel = indicators.rsi14 != null
            ? indicators.rsi14 >= 65 ? '(strong bullish momentum)'
                : indicators.rsi14 <= 35 ? '(strong bearish momentum)'
                    : indicators.rsi14 > 50 ? '(bullish lean)'
                        : '(bearish lean)'
            : '';
        const parts = [];
        if (indicators.rsi14 != null)
            parts.push(`RSI14: ${indicators.rsi14.toFixed(1)} ${rsiLabel}`);
        if (indicators.ema20 != null)
            parts.push(`EMA20: ${indicators.ema20.toFixed(dp)}`);
        if (indicators.ema50 != null)
            parts.push(`EMA50: ${indicators.ema50.toFixed(dp)} → ${trendLabel}`);
        if (indicators.atr14 != null)
            parts.push(`ATR14: ${formatAtr(indicators.atr14, dp, forex?.pipSize)}`);
        if (indicators.bbWidth != null && indicators.bbWidth > 0) {
            const bbPct = (indicators.bbWidth * 100).toFixed(2);
            const bbLabel = indicators.bbWidth < 0.005 ? ' ⚠ SQUEEZE' : indicators.bbWidth > 0.03 ? ' (high volatility)' : '';
            parts.push(`BB Width: ${bbPct}%${bbLabel}`);
        }
        if (indicators.vwap != null && indicators.vwap > 0) {
            const vwapRel = price?.last != null
                ? price.last > indicators.vwap ? ' (price above VWAP — bullish intraday)' : ' (price below VWAP — bearish intraday)'
                : '';
            parts.push(`VWAP: ${indicators.vwap.toFixed(dp)}${vwapRel}`);
        }
        if (parts.length > 0)
            lines.push(parts.join(' | '));
    }
    // ── Multi-timeframe indicator summary ──────────────────────────────────────
    const mtf = indicators?.mtf;
    if (mtf) {
        const mtfParts = [];
        if (mtf.m15) {
            const m15Bias = mtf.m15.rsi14 > 50 ? 'bullish' : 'bearish';
            mtfParts.push(`M15: RSI ${mtf.m15.rsi14.toFixed(1)} (${m15Bias})`);
        }
        if (mtf.h4) {
            const h4Trend = (mtf.h4.ema50 != null && mtf.h4.ema20 > mtf.h4.ema50) ? '▲ bullish' : (mtf.h4.ema50 != null ? '▼ bearish' : '?');
            mtfParts.push(`H4: RSI ${mtf.h4.rsi14.toFixed(1)} | EMA trend ${h4Trend}`);
        }
        const confLabel = mtf.confluence >= 2 ? 'STRONG BULLISH' : mtf.confluence <= -2 ? 'STRONG BEARISH' : mtf.confluence > 0 ? 'lean bullish' : mtf.confluence < 0 ? 'lean bearish' : 'neutral';
        mtfParts.push(`Confluence: ${mtf.confluence > 0 ? '+' : ''}${mtf.confluence}/3 → ${confLabel}`);
        lines.push(`MTF: ${mtfParts.join(' | ')}`);
    }
    // ── Multi-timeframe candle trend ────────────────────────────────────────────
    if (candles?.h4 && candles.h4.length >= 3) {
        lines.push(`H4 (last 3 bars): ${candleTrendLine(candles.h4, 3, dp)}`);
    }
    if (candles?.h1 && candles.h1.length >= 5) {
        lines.push(`H1 (last 5 bars): ${candleTrendLine(candles.h1, 5, dp)}`);
    }
    if (candles?.m15 && candles.m15.length >= 5) {
        lines.push(`M15 (last 5 bars): ${candleTrendLine(candles.m15, 5, dp)}`);
    }
    if (candles?.m1 && candles.m1.length >= 5) {
        lines.push(`M1 (last 10 bars): ${candleTrendLine(candles.m1, 10, dp)}`);
    }
    // ── Dynamic position sizing ────────────────────────────────────────────────
    // Computes lots from: daily target, R:R, ATR-based stop, leverage, margin
    const pipSz = forex?.pipSize;
    if (forex?.pipValue != null && pipSz != null && pipSz > 0
        && accountInfo?.equity != null && indicators?.atr14 != null) {
        const pipVal = forex.pipValue; // $ value of 1 pip per 1 lot
        const atrPips = indicators.atr14 / pipSz; // ATR in pips (uses pipSize, not point)
        const slPips = Math.round(atrPips * 1.0 * 10) / 10; // SL = 1× ATR (structural)
        const equity = accountInfo.equity;
        const freeMargin = accountInfo.freeMargin ?? equity;
        const leverage = config?.leverage ?? accountInfo.leverage ?? 100;
        const dailyTarget = config?.dailyTargetUsd ?? 500; // daily $ target
        const maxRiskPct = config?.maxRiskPercent ?? 10; // max % of equity at risk per trade
        const rrRatio = 1.5; // minimum R:R
        // TP reward per lot = slPips × R:R × pipValue
        const rewardPerLot = slPips * rrRatio * pipVal;
        // Risk per lot      = slPips × pipValue
        const riskPerLot = slPips * pipVal;
        // 1) Target-based sizing: how many lots to hit daily target at TP
        const lotsByTarget = rewardPerLot > 0 ? dailyTarget / rewardPerLot : 0.01;
        // 2) Risk cap: max lots where loss at SL ≤ maxRiskPct% of equity
        const maxRiskUsd = equity * (maxRiskPct / 100);
        const lotsByRisk = riskPerLot > 0 ? maxRiskUsd / riskPerLot : 0.01;
        // 3) Margin cap: lots that use ≤ 50% of free margin
        const currentPrice = price?.last ?? 0;
        const contractSize = pipVal / pipSz; // ~100000 for forex, ~100 for gold
        const marginPerLot = currentPrice > 0 ? (contractSize * currentPrice) / leverage : 0;
        const lotsByMargin = marginPerLot > 0 ? (freeMargin * 0.5) / marginPerLot : 0.01;
        // Final: minimum of all three, floored at 0.01
        const suggestedLots = Math.max(0.01, Math.floor(Math.min(lotsByTarget, lotsByRisk, lotsByMargin) * 100) / 100);
        // Store for guardrail clamp
        if (agentKey)
            suggestedLotsByAgent.set(agentKey, suggestedLots);
        const riskUsd = suggestedLots * riskPerLot;
        const rewardUsd = suggestedLots * rewardPerLot;
        const marginNeeded = suggestedLots * marginPerLot;
        lines.push(`POSITION SIZING (use this):`, `  Daily target: $${dailyTarget} | Max risk: ${maxRiskPct}% ($${maxRiskUsd.toFixed(0)}) | Leverage: 1:${leverage}`, `  ATR-based SL: ~${slPips.toFixed(1)} pips ($${riskPerLot.toFixed(0)}/lot) | TP at R:R ${rrRatio}: ~${(slPips * rrRatio).toFixed(1)} pips ($${rewardPerLot.toFixed(0)}/lot)`, `  ► SUGGESTED SIZE: ${suggestedLots.toFixed(2)} lots — risk $${riskUsd.toFixed(0)}, reward $${rewardUsd.toFixed(0)}, margin $${marginNeeded.toFixed(0)}`, `  (System will reject orders above ${Math.max(0.01, Math.round(suggestedLots * 2 * 100) / 100)} lots)`);
    }
    if (positions && positions.length > 0) {
        const totalFloat = positions.reduce((s, p) => s + p.profit, 0);
        lines.push(`OPEN POSITIONS (${positions.length}) | Total Float: ${totalFloat >= 0 ? '+' : ''}$${totalFloat.toFixed(2)}:`);
        const pipSz = forex?.pipSize ?? 1;
        const pipVal = forex?.pipValue ?? 0;
        for (const p of positions) {
            // SL: show price + pip distance + dollar risk at current size
            let slDetail;
            if (p.sl != null && p.sl > 0 && pipSz > 0) {
                const slPips = Math.abs(p.priceCurrent - p.sl) / pipSz;
                const slRiskUsd = pipVal > 0 ? slPips * pipVal * p.volume : 0;
                slDetail = `SL: ${p.sl.toFixed(dp)} (${slPips.toFixed(1)} pips away, $${slRiskUsd.toFixed(0)} risk)`;
            }
            else {
                slDetail = 'SL: ⚠ NONE — unprotected!';
            }
            const tpDetail = p.tp != null && p.tp > 0 ? `TP: ${p.tp.toFixed(dp)}` : 'TP: none';
            const swapDetail = p.swap != null && p.swap !== 0 ? ` | swap: $${p.swap.toFixed(2)}` : '';
            const commentDetail = p.comment ? ` [${p.comment}]` : '';
            lines.push(`  #${p.ticket} ${p.side} ${p.volume}L @ ${p.priceOpen.toFixed(dp)} | now: ${p.priceCurrent.toFixed(dp)} | P&L: $${p.profit.toFixed(2)} | ${slDetail} | ${tpDetail}${swapDetail}${commentDetail}`);
        }
    }
    else {
        lines.push('Open Positions: none');
    }
    if (pendingOrders && pendingOrders.length > 0) {
        lines.push(`Pending Orders (${pendingOrders.length}):`);
        for (const o of pendingOrders) {
            const distPart = (o.priceCurrent != null && o.priceTarget != null && forex?.pipSize != null)
                ? ` | ${Math.abs(o.priceCurrent - o.priceTarget) / forex.pipSize < 0.1 ? '⚡ AT LEVEL' : `${(Math.abs(o.priceCurrent - o.priceTarget) / forex.pipSize).toFixed(1)} pips away`}`
                : '';
            const commentPart = o.comment ? ` [${o.comment}]` : '';
            lines.push(`  #${o.ticket} ${o.type} ${o.volume}L @ ${o.priceTarget.toFixed(dp)}${distPart} | SL: ${o.sl?.toFixed(dp) ?? 'none'} TP: ${o.tp?.toFixed(dp) ?? 'none'}${commentPart}`);
        }
    }
    const keyLevels = snap.keyLevels;
    if (keyLevels && keyLevels.length > 0) {
        lines.push(`Key Levels (${keyLevels.length}):`);
        for (const l of keyLevels.slice(0, 8)) {
            const stars = '★'.repeat(l.strength);
            lines.push(`  ${l.type.toUpperCase().padEnd(12)} ${l.price.toFixed(dp)} [${l.source}] ${stars}`);
        }
    }
    const context = snap.context;
    const forexNews = context?.forexNews;
    if (forexNews && forexNews.length > 0) {
        const symbol = snap.symbol;
        lines.push(`News Sentiment${symbol ? ` (${symbol})` : ''}:`);
        for (const n of forexNews.slice(0, 4)) {
            const tag = n.sentiment === 'bullish' ? '📈' : n.sentiment === 'bearish' ? '📉' : '➖';
            lines.push(`  ${tag} ${n.headline}`);
        }
    }
    // Recent closed deals today — lets the agent see stopped-out/TP'd trades without calling a tool
    if (recentDeals && recentDeals.length > 0) {
        const DEAL_TYPE = { 0: 'BUY', 1: 'SELL' };
        const tradingDeals = recentDeals.filter(d => d.type === 0 || d.type === 1);
        if (tradingDeals.length > 0) {
            // Sum today's realized P&L (profit + commission + swap on closed trades)
            const totalRealized = tradingDeals.reduce((s, d) => s + d.profit + d.commission + d.swap, 0);
            const realizedStr = totalRealized >= 0 ? `+$${totalRealized.toFixed(2)}` : `-$${Math.abs(totalRealized).toFixed(2)}`;
            lines.push(`Closed trades today (${tradingDeals.length}) | Realized P&L: ${realizedStr}:`);
            for (const d of tradingDeals.slice(0, 8)) {
                const dir = DEAL_TYPE[d.type] ?? `TYPE${d.type}`;
                const pnl = d.profit >= 0 ? `+$${d.profit.toFixed(2)}` : `-$${Math.abs(d.profit).toFixed(2)}`;
                const fees = (d.commission !== 0 || d.swap !== 0)
                    ? ` (comm: $${d.commission.toFixed(2)}, swap: $${d.swap.toFixed(2)})`
                    : '';
                const exit = d.comment ? ` [${d.comment}]` : '';
                const t = new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                lines.push(`  #${d.ticket} ${dir} ${d.volume} @ ${d.price.toFixed(dp)} | P&L: ${pnl}${fees}${exit} at ${t}`);
            }
        }
    }
    // ── Monte Carlo probability table ──────────────────────────────────────────
    if (mc) {
        lines.push(formatMCBlock(mc, forex?.pipSize ?? 1, dp));
    }
    return lines.join('\n');
}
// ── Session compression ───────────────────────────────────────────────────────
const KEEP_MESSAGES = 30;
/**
 * Find the index at which to cut the messages array for compression.
 * We must start the kept slice on a "tick boundary" — a user message with
 * string content (i.e. a tick user message, NOT a tool_result user message).
 * This prevents sending tool_result blocks without a preceding tool_use to the API.
 */
function findTickBoundaryCutPoint(messages, keepAtLeast) {
    if (messages.length <= keepAtLeast)
        return 0;
    const candidateCut = messages.length - keepAtLeast;
    // Find first tick boundary at or after the candidate cut point
    for (let i = candidateCut; i < messages.length; i++) {
        if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
            return i;
        }
    }
    return 0; // no safe cut point found — don't compress
}
function compressToSummary(messages) {
    const lines = [];
    for (const msg of messages) {
        if (msg.role !== 'assistant')
            continue;
        const content = Array.isArray(msg.content) ? msg.content : [];
        for (const block of content) {
            if (block.type === 'text' && block.text) {
                const decMatch = block.text.match(/DECISION:\s*(.+?)(?:\n|$)/i);
                const reasonMatch = block.text.match(/REASON:\s*(.+?)(?:\n|$)/i);
                if (decMatch) {
                    const parts = [`• ${decMatch[1].trim()}`];
                    if (reasonMatch)
                        parts[0] += ` — ${reasonMatch[1].trim()}`;
                    // Extract indicator state at decision time
                    const rsiMatch = block.text.match(/RSI\s*(?:14)?\s*[:=]?\s*([\d.]+)/i);
                    const emaMatch = block.text.match(/EMA20\s*[<>]\s*EMA50|(?:bullish|bearish)\s+trend/i);
                    if (rsiMatch || emaMatch) {
                        const indicators = [];
                        if (rsiMatch)
                            indicators.push(`RSI=${rsiMatch[1]}`);
                        if (emaMatch)
                            indicators.push(emaMatch[0].toLowerCase().includes('bullish') ? 'trend=bullish' : 'trend=bearish');
                        parts.push(`  [${indicators.join(', ')}]`);
                    }
                    // Extract key price levels mentioned
                    const levelMatches = block.text.match(/(?:support|resistance|level)\s+(?:at\s+)?(\d+\.?\d*)/gi);
                    if (levelMatches && levelMatches.length > 0) {
                        const levels = levelMatches.slice(0, 3).map(m => {
                            const numMatch = m.match(/(\d+\.?\d*)/);
                            const type = m.toLowerCase().includes('support') ? 'S' : m.toLowerCase().includes('resistance') ? 'R' : 'L';
                            return numMatch ? `${type}:${numMatch[1]}` : null;
                        }).filter(Boolean);
                        if (levels.length > 0)
                            parts.push(`  levels: ${levels.join(', ')}`);
                    }
                    lines.push(parts.join('\n'));
                }
            }
            if (block.type === 'tool_use' && ['place_order', 'close_position', 'cancel_order', 'modify_position'].includes(block.name ?? '')) {
                const inp = block.input ?? {};
                let summary;
                if (block.name === 'place_order')
                    summary = `${inp.side} ${inp.quantity} @ ${inp.price}`;
                else if (block.name === 'close_position')
                    summary = `closed ticket ${inp.ticket}`;
                else if (block.name === 'modify_position')
                    summary = `modified #${inp.ticket} sl=${inp.sl ?? '—'} tp=${inp.tp ?? '—'}`;
                else
                    summary = `cancelled ${inp.orderId ?? inp.ticket}`;
                lines.push(`  ↳ ${block.name}: ${summary}`);
            }
        }
    }
    return lines.length > 0 ? lines.join('\n') : '(no decisions recorded)';
}
// ── System Prompt ─────────────────────────────────────────────────────────────
export function buildSystemPrompt(config, agentKey, sessionSummary) {
    const { market, customPrompt } = config;
    // ── Load dynamic content from DB ──────────────────────────────────────────────
    const { symbol } = config;
    const perf = dbGetAgentPerformance(agentKey, 10);
    const perfSection = perf.totalCycles > 0
        ? `\n\nYOUR RECENT PERFORMANCE (last ${perf.totalCycles} ticks on ${symbol}):\n- Decisions: BUY ${perf.buys} | SELL ${perf.sells} | HOLD ${perf.holds}\n- Last decisions: ${perf.lastDecisions.map(d => `[${d.time.slice(11, 16)}] ${d.decision.split(' ')[0]}`).join(' → ')}${perf.holds >= 10 && perf.buys === 0 && perf.sells === 0 ? '\nNOTE: You have held for many ticks. This is fine if no high-conviction setup has appeared. Do not force a trade just because you have been waiting — but do check if you are missing a clear signal.' : ''}`
        : '';
    const strategy = dbGetStrategy(agentKey);
    const strategyContent = strategy ? `## TRADING STRATEGY: "${strategy.name}"
Style: ${strategy.style.toUpperCase()} | ${strategy.timeframe ? `Timeframe: ${strategy.timeframe} | ` : ''}${strategy.bias ? `Bias: ${strategy.bias.replace('_', ' ').toUpperCase()} | ` : ''}Max Positions: ${strategy.maxPositions}

ENTRY RULES:
${strategy.entryRules}

EXIT RULES:
${strategy.exitRules}
${strategy.filters ? `\nFILTERS:\n${strategy.filters}` : ''}
${strategy.notes ? `\nNOTES:\n${strategy.notes}` : ''}` : '';
    const memories = dbGetMemories(agentKey, undefined, 20);
    const groupedMemories = memories.reduce((acc, m) => {
        if (!acc[m.category])
            acc[m.category] = [];
        acc[m.category].push(m);
        return acc;
    }, {});
    const memoryContent = memories.length > 0 ? `## YOUR PERSISTENT MEMORY (${symbol} — ${memories.length} entries)
${Object.entries(groupedMemories).map(([cat, mems]) => `[${cat.toUpperCase()}]\n${mems.map(m => `• ${m.key} (conf ${m.confidence.toFixed(1)}): ${m.value}`).join('\n')}`).join('\n\n')}

Use save_memory to add new observations. Use delete_memory when a level/pattern becomes invalid.` : '';
    const activePlan = dbGetActivePlan(agentKey);
    const planContent = activePlan ? `## CURRENT SESSION PLAN
Bias: ${activePlan.marketBias.toUpperCase()}${activePlan.sessionLabel ? ` | Session: ${activePlan.sessionLabel}` : ''}
${activePlan.keyLevels ? `Key Levels: ${activePlan.keyLevels}` : ''}
${activePlan.riskNotes ? `Risk Notes: ${activePlan.riskNotes}` : ''}
Plan: ${activePlan.planText}` : '';
    const historyContent = sessionSummary ? `## SESSION HISTORY (earlier ticks today — compressed)
${sessionSummary}
(Your full conversation for recent ticks is in the message history below.)` : '';
    const marketRulesContent = market === 'mt5'
        ? `CURRENT SESSION: ${sessionLabel()}
MT5 SESSION RULES: Only trade during Tokyo, London, or New York sessions. Reject entries when sessionOpen is false.
SPREAD: The spread is shown in the tick data. For forex pairs it is shown in pips; for metals (XAUUSD etc.) it is shown in points with the dollar value. IMPORTANT: a 67-point spread on XAUUSD is only $0.67 — that is NORMAL. Compare spread to ATR in DOLLAR terms, not in raw numbers. Only skip a trade if spread cost > 20% of your expected profit in dollars.
MT5 provides real swap rates in the snapshot — factor overnight costs into hold decisions for multi-day positions.

MT5 POSITION & ORDER MANAGEMENT (critical):
The snapshot contains TWO important arrays — read both before deciding:
  positions[] — your currently open trades. Each has: ticket, side, volume, priceOpen, priceCurrent, profit (unrealised), sl, tp, swap.
  pendingOrders[] — your pending limit/stop orders not yet filled. Each has: ticket, type (BUY_LIMIT/SELL_LIMIT/BUY_STOP/SELL_STOP), volume, priceTarget, sl, tp.

Rules:
- To CLOSE an open position: call close_position(ticket). NEVER place an opposite-side order — it opens a second position.
- To TRAIL or adjust SL/TP: call modify_position(ticket, sl, tp). Use this to move SL to breakeven once in profit ≥ 1× ATR, or to trail SL behind structural levels as price extends in your favour.
- To CANCEL a pending order: call cancel_order(ticket). Do this if the order is no longer valid given current price/indicators.
- Do not open a new position if one is already open for this symbol (unless pyramiding is justified by strong signal).
- Do not place a duplicate pending order if one already exists at the same price level.
- If a position shows negative profit approaching SL: let the SL do its job UNLESS your original trade thesis is clearly invalidated (e.g. trend reversed on higher TF). Do not close early just because you are losing — that is what the stop is for.
- If pendingOrders is empty and price is near a key level, consider placing a limit order for better entry rather than chasing with market orders.`
        : '';
    const leverageContent = config.leverage
        ? `Account leverage: 1:${config.leverage} — use this to calculate required margin: margin = (volume × contractSize × price) ÷ leverage. For XAUUSD at $4900 with 100oz contract and 1:500 leverage: 0.01 lots = ($4900 × 100 × 0.01) ÷ 500 = $9.80 margin required`
        : '';
    const dailyTarget = config.dailyTargetUsd ?? 500;
    const maxRiskPct = config.maxRiskPercent ?? 10;
    const riskRulesContent = `RISK RULES (non-negotiable):
- POSITION SIZING: each tick message contains a "POSITION SIZING" block with a SUGGESTED SIZE computed from your daily target ($${dailyTarget}), account equity, leverage, ATR-based stop distance, and R:R 1.5:1. USE THAT EXACT LOT SIZE. Do not invent your own. The system WILL REJECT orders above 2× the suggested amount.
- Max risk per trade: ${maxRiskPct}% of equity. The sizing already accounts for this — just use the suggested lots.
- Stop placement: place SL at a STRUCTURAL level (recent swing high/low, support/resistance, round number) — not an arbitrary pip distance. Then verify the distance is at LEAST ATR14 × 1.0. If no clear structural level exists within reasonable risk, DO NOT enter the trade.
- Take profit: place TP at the next structural level in your trade direction (resistance for longs, support for shorts). The reward must be at least 1.5× the risk (distance to SL). If R:R < 1.5, skip the trade.
- Once a position profits by 1× ATR, call modify_position to move SL to breakeven.
- Trail stop: as price extends in your favour, trail SL behind structural levels. Do NOT trail so tight that normal retracements stop you out.
- You MAY add to a winning position (same direction) if RSI confirms and total lots stay within 2× the suggested size.
- Close losers at your stop — do not widen stops to avoid a loss.
- Do NOT close a winning trade early out of fear. Let your TP or trailing stop do the work.`;
    const outputFormatContent = `EXECUTION RULES (mandatory — the DECISION line does NOT trigger a trade by itself):
- If BUY or SELL: call place_order FIRST, then write the DECISION line.
- If CLOSE: call close_position(ticket) FIRST, then write the DECISION line.
- If CANCEL: call cancel_order FIRST, then write the DECISION line.
- If HOLD: do NOT call any order tool. Just write the DECISION line.
- Always include stopPips AND tpPips on place_order. SL at structural level (min ATR14 × 1.0). TP at next structural target. Both are mandatory for every new order.

DECISION FORMAT (write AFTER executing the tool call):
DECISION: [HOLD | BUY <qty> @ <price> SL: <price> TP: <price> | SELL <qty> @ <price> SL: <price> TP: <price> | CLOSE <ticket> | CANCEL <orderId>]
REASON: <1-2 sentences explaining the structural levels used for entry, SL, and TP>`;
    // ── Template rendering ────────────────────────────────────────────────────────
    if (config.promptTemplate && config.promptTemplate.trim().length > 0) {
        const pills = {
            symbol: config.symbol,
            market: config.market,
            leverage: leverageContent,
            market_rules: marketRulesContent,
            strategy: strategyContent,
            memory: memoryContent,
            plan: planContent,
            session_history: historyContent,
            risk_rules: riskRulesContent,
            output_format: outputFormatContent,
        };
        let rendered = config.promptTemplate;
        for (const [key, value] of Object.entries(pills)) {
            rendered = rendered.split(`{{${key}}}`).join(value);
        }
        return customPrompt ? `${rendered}\n\nADDITIONAL INSTRUCTIONS:\n${customPrompt}` : rendered;
    }
    // ── Default prompt (no template) ──────────────────────────────────────────────
    const mode = '[LIVE TRADING]';
    const base = `You are Wolf-Fin, an autonomous trading agent. ${mode}

ROLE: Patient, disciplined, risk-first trader. You run as a continuous session — each tick you receive a market update and decide what to do next. You remember your full conversation history from earlier ticks today.

CORE PHILOSOPHY:
- The best traders spend 80% of their time WAITING. No position is a valid position.
- Quality over quantity: one well-reasoned trade is worth more than five impulsive ones.
- NEVER repeat a failed setup. If you were stopped out at a level, that level is not your edge — move on.
- Once in a trade, LET IT PLAY OUT. Your SL and TP exist for a reason. Do not micro-manage or panic-close.
- Every entry must have a clear thesis: what price level are you targeting, where is your stop, and WHY does the market structure support this trade right now.

SELF-IMPROVEMENT:
- After every closed trade (win or loss), use save_memory to record what worked and what didn't.
- Before entering a new trade, check read_memories for lessons from recent trades on this symbol.
- If you have 2+ consecutive losses, STOP and reassess. Write a brief post-mortem using save_memory before considering another entry. Ask yourself: "Am I reading the market correctly, or am I forcing a bias?"
- Track your session P&L mentally. If down significantly, reduce size or switch to observation mode.

PROCESS:
1. Review your conversation history — you remember every decision made in this session today.
2. Each tick message includes an auto-fetched market snapshot (price, indicators, positions). Use it directly.
3. Call get_snapshot if you need candle data or more granular detail not in the summary.
4. Reason through evidence: trend (EMA cross), momentum (RSI), volatility (ATR, BB width), key levels.
5. Decide: HOLD / BUY qty @ price / SELL qty @ price / CLOSE ticket / CANCEL orderId.
6. Execute via place_order, close_position, or cancel_order. Prefer LIMIT orders for better entries.
${market === 'mt5' ? '7. MT5: always include stopPips AND tpPips on every new order. SL at structural level, TP at next structural target.\n' : ''}${leverageContent ? `\nACCOUNT CONFIG:\n- ${leverageContent}\n` : ''}
${riskRulesContent}
${marketRulesContent ? `\n${marketRulesContent}` : ''}`;
    const strategySection = strategyContent ? `\n\n${strategyContent}` : '';
    const memorySection = memoryContent ? `\n\n${memoryContent}` : '';
    const planSection = planContent ? `\n\n${planContent}` : '';
    const historySection = historyContent ? `\n\n${historyContent}` : '';
    const decisionFormat = `\n\n${outputFormatContent}`;
    const full = base + perfSection + strategySection + memorySection + planSection + historySection + decisionFormat;
    return customPrompt ? `${full}\n\nADDITIONAL INSTRUCTIONS:\n${customPrompt}` : full;
}
// ── Tick user message ─────────────────────────────────────────────────────────
function buildTickMessage(config, agentKey, tickNumber, isFirstTick, tickType, snapshotSummary, externalCloseNote, newsItems) {
    const time = new Date().toLocaleTimeString();
    const sessionMinsLeft = config.market === 'mt5' ? minutesUntilSessionClose() : null;
    const sessionInfo = sessionMinsLeft !== null
        ? ` | ${sessionMinsLeft >= 60 ? `${Math.floor(sessionMinsLeft / 60)}h ${sessionMinsLeft % 60}m` : `${sessionMinsLeft}m`} left in session`
        : '';
    const header = `Tick #${tickNumber} | ${time} | ${config.symbol} (${config.market.toUpperCase()})${sessionInfo}`;
    const snapshotBlock = snapshotSummary
        ? `CURRENT MARKET SNAPSHOT (auto-fetched):\n${snapshotSummary}`
        : `Snapshot unavailable — call get_snapshot to get current market state.`;
    const extNote = externalCloseNote
        ? `\n\n⚠ EXTERNALLY CLOSED POSITIONS (since last tick):\n${externalCloseNote}\nDo NOT attempt to close these tickets — they no longer exist.\nIMPORTANT: Call save_memory to record what happened with this trade — what worked, what failed, and what you would do differently.`
        : '';
    const newsBlock = newsItems && newsItems.length > 0
        ? `\nRECENT NEWS (${newsItems.length} headlines):\n` + newsItems.map(n => `  [${n.sentiment.toUpperCase()}] ${n.headline} — ${n.source}`).join('\n')
        : '';
    if (tickType === 'planning') {
        return `${header}

${snapshotBlock}${extNote}${newsBlock}

${isFirstTick ? `Run a PLANNING CYCLE for ${config.symbol}.

Your ONLY goal is to produce a structured session plan. Do NOT place, cancel, or close any orders.

REQUIRED STEPS — complete all of them in order:
1. Analyse the snapshot data above (multi-timeframe picture):
   - Overall trend direction (EMA20 vs EMA50)
   - Momentum state (RSI overbought/oversold/neutral)
   - Volatility (ATR, BB width)
   - Key price levels visible in the data
2. Identify 2–4 key price levels (support, resistance, or pivots) with clear rationale
3. Decide your session bias: bullish / bearish / neutral / range — and explain why
4. Define exactly what setup would trigger a trade entry this session (be specific)
5. Note any risk filters: news timing, spread conditions, session hours
6. REQUIRED: Call save_plan with your complete plan. This is mandatory — do not skip it.
7. Optional: Call save_memory for any observations worth persisting beyond this session

REQUIRED OUTPUT after all tool calls:
PLAN: <one sentence stating your session bias and primary trade setup>

You MUST call save_plan before finishing. A planning tick with no plan saved is a failure.`
            : `Review your session plan. Update it with save_plan if market conditions have changed significantly.

End with PLAN: <brief summary of current bias and any changes made>.`}`;
    }
    // Trading tick
    const historyNote = isFirstTick
        ? `This is your first tick of today's session.`
        : `Your conversation history above shows what you decided in previous ticks and why.`;
    const signalPriority = `
OUTPUT RULES — CRITICAL:
- ALWAYS write your reasoning as text BEFORE calling any tool. Explain what you are checking and why.
- ALWAYS write your analysis as text AFTER receiving tool results. Explain what you see and what it means.
- NEVER call a tool without first writing at least one sentence of reasoning.
- Your text reasoning is logged and reviewed. Silent tool calls with no explanation are unacceptable.

EVALUATION ORDER — follow strictly every tick:
0. VERIFY STATE — call get_open_orders FIRST, every tick, no exceptions.
   MT5 can fill, reject, or externally close orders between ticks. Never trust memory alone.
   Then read the full snapshot above. Explicitly note:
   - Account: Balance / Equity / Free Margin / Margin Level — can you afford another trade?
   - Today's Realized P&L — are you at or near your daily target? Already at max loss?
   - Float P&L — are open positions winning or losing right now?
   - Trend (EMA cross label) + Momentum (RSI label) — what does the market say RIGHT NOW?
   - BB Width — is the market squeezing (low volatility, breakout imminent) or expanding?
   - VWAP — is price above or below intraday fair value?
   - Session — is the session OPEN? How much time is left?
   You must reference these in your reasoning. Skipping any of them is not permitted.
1. MANAGE OPEN POSITIONS (if any):
   a. State the current P&L in dollars and pips. State whether the position is in profit or loss RIGHT NOW.
   b. Evaluate the position direction against CURRENT market structure — regardless of who placed the trade:
      - Is this a LONG? → Is EMA20 > EMA50? Is RSI > 50? Is price above key support? If NO to most → thesis is broken.
      - Is this a SHORT? → Is EMA20 < EMA50? Is RSI < 50? Is price below key resistance? If NO to most → thesis is broken.
      - A position with a SL is NOT a reason to skip analysis. "It has a stop loss" is not a decision — it is an abdication.
   c. Check SL and TP: Are they set? Are they at structural levels? If TP is missing, call modify_position to add one.
   d. If in profit > 1× ATR → move SL to breakeven (modify_position).
   e. If in profit > 2× ATR → trail SL behind the last structural level.
   f. EXTERNALLY PLACED positions (positions you did not enter this session): apply the same framework as above.
      Ask yourself: "Would I enter this trade RIGHT NOW given current data?" If YES → hold and manage it.
      If NO → close it. Do NOT passively monitor an externally placed trade just because it has a stop loss.
   g. ONLY use "let the SL handle it" if the trade direction IS confirmed by current structure AND price has not yet reached your target. Never use it as a substitute for analysis.
2. MANAGE PENDING ORDERS — cancel limit/stop orders only if the level is no longer relevant.
3. IF NO POSITION — you MUST evaluate BOTH a long setup AND a short setup. Do not evaluate one direction and stop.
   For each direction, work through the checklist and state explicitly whether it PASSES or FAILS with a reason.

   LONG SETUP (BUY):
   a. TREND: EMA20 > EMA50? If NO → long trend fails.
   b. MOMENTUM: RSI14 > 50 confirms bullish momentum. RSI 35–50 = neutral-bearish caution. RSI < 35 = strong
      bearish momentum — do NOT use as a "buy signal"; it means the market is selling hard. Long FAILS.
   c. KEY LEVEL: Is price at or bouncing from a clear support level? If NO → long level fails.
   d. VOLATILITY: ATR14 for stop sizing. Spread < 20% of expected profit in dollar terms.
   e. R:R: SL below structural support, TP at next resistance. R:R ≥ 1.5. If not achievable → long fails.
   f. VERDICT: LONG VALID only if trend + momentum + level ALL pass. State "LONG: VALID" or "LONG: REJECTED — [reason]".

   SHORT SETUP (SELL):
   a. TREND: EMA20 < EMA50? If NO → short trend fails.
   b. MOMENTUM: RSI14 < 50 confirms bearish momentum. RSI 50–65 = neutral-bullish caution. RSI > 65 = strong
      bullish momentum — do NOT use as a "sell signal"; it means the market is buying hard. Short FAILS.
   c. KEY LEVEL: Is price at or breaking below a clear resistance or previous support turned resistance? If NO → short level fails.
   d. VOLATILITY: ATR14 for stop sizing. Spread < 20% of expected profit in dollar terms.
   e. R:R: SL above structural resistance, TP at next support. R:R ≥ 1.5. If not achievable → short fails.
   f. VERDICT: SHORT VALID only if trend + momentum + level ALL pass. State "SHORT: VALID" or "SHORT: REJECTED — [reason]".

   HOLD only if BOTH long AND short are REJECTED. Your reasoning must show both verdicts.
   g. HISTORY CHECK — have you been stopped out at this same level/setup before today? If yes, DO NOT re-enter. Save it to memory.
4. LIMIT ORDERS — if conditions are close but not quite right, consider a LIMIT order at a better price rather than chasing with a MARKET order.
5. LEARN — after ANY position closes (SL hit, TP hit, or manual close):
   a. Call save_memory with category "risk" to record what worked/failed and why.
   b. Note the price level, setup type, and outcome (e.g. "Short at 4686 support failed 3x — level is a buyer trap").
   c. This is MANDATORY after every closed trade. Do not skip it.
`;
    return `${header}

${snapshotBlock}${extNote}${newsBlock}

${historyNote}
${signalPriority}
TASK: Evaluate the market and manage your positions. If you have an open position, your PRIMARY job is managing it actively — state its P&L, validate its direction against current structure, and decide: hold (with reason), modify SL/TP, or close. "I will monitor it" is not a valid decision. If flat, only enter when trend + momentum + key level ALL align and R:R ≥ 1.5. Patience is your edge. A missed trade costs nothing; a bad trade costs real money.${config.market !== 'mt5' ? ' Call get_order_book only if sizing a new entry.' : ''}

When you are done analysing, write your FULL analysis summary (what you checked, what the data shows, why you are making this decision), then end with EXACTLY these two lines:
DECISION: [HOLD | BUY <qty> @ <price> SL:<price> TP:<price> | SELL <qty> @ <price> SL:<price> TP:<price> | CLOSE <ticket> | CANCEL <orderId>]
REASON: <1-2 sentences of evidence>

Your analysis text and reasoning are critical — they are logged and reviewed. Do not skip them.`;
}
// ── Tool result summariser ────────────────────────────────────────────────────
function summariseToolResult(name, result) {
    try {
        if (name === 'get_snapshot') {
            const s = result;
            return `price=${s.price?.last?.toFixed(4)} rsi=${s.indicators?.rsi14?.toFixed(1)} ema20=${s.indicators?.ema20?.toFixed(4)} 24hChg=${s.stats24h?.changePercent?.toFixed(2)}%`;
        }
        if (name === 'get_order_book') {
            const b = result;
            const bid = b.bids?.[0]?.[0];
            const ask = b.asks?.[0]?.[0];
            if (bid === undefined && ask === undefined)
                return 'no DOM data (broker does not publish order book)';
            return `best bid=${bid} ask=${ask}`;
        }
        if (name === 'place_order') {
            const o = result;
            if (o.blocked)
                return `BLOCKED — ${o.reason}`;
            return `status=${o.status} orderId=${o.orderId}`;
        }
        if (name === 'get_open_orders') {
            const orders = result;
            if (!Array.isArray(orders) || orders.length === 0)
                return '[] (no open positions or pending orders)';
            const open = orders.filter(o => o.status === 'OPEN');
            const pending = orders.filter(o => o.status === 'NEW');
            const parts = [];
            if (open.length > 0)
                parts.push(`${open.length} open: ${open.map(o => `#${o.orderId} ${o.side} ${o.origQty}@${o.price}`).join(', ')}`);
            if (pending.length > 0)
                parts.push(`${pending.length} pending: ${pending.map(o => `#${o.orderId} ${o.type} ${o.origQty}@${o.price}`).join(', ')}`);
            return parts.join(' | ');
        }
        if (name === 'cancel_order')
            return 'cancelled';
        if (name === 'close_position') {
            const o = result;
            return o.closed ? `closed ticket=${o.ticket}` : 'close failed';
        }
        if (name === 'modify_position') {
            const o = result;
            return o.ok ? `modified #${o.ticket} sl=${o.sl ?? '—'} tp=${o.tp ?? '—'}` : 'modify failed';
        }
        return JSON.stringify(result).slice(0, 120);
    }
    catch {
        return '(unparseable)';
    }
}
// ── Tool Dispatcher ───────────────────────────────────────────────────────────
async function dispatchTool(name, input, defaultMarket, mt5AccountId, agentKey = '') {
    // Reject tool calls with malformed JSON from Ollama/local models
    if (input._parse_error) {
        return { error: `Tool call "${name}" had unparseable JSON arguments. Please re-emit this tool call with valid JSON. Raw: ${input._raw ?? '(unknown)'}` };
    }
    const market = input.market ?? defaultMarket;
    const adapter = getAdapter(market, mt5AccountId);
    switch (name) {
        case 'get_snapshot': {
            const riskState = market === 'mt5' ? getRiskStateFor('mt5') : getRiskState();
            const snap = await adapter.getSnapshot(input.symbol, riskState);
            snap.context = await buildMarketContext(input.symbol, market);
            const openNotional = snap.account.openOrders.reduce((sum, o) => sum + o.price * o.origQty, 0);
            updatePositionNotionalFor(market, openNotional);
            if (market === 'mt5' && snap.forex) {
                const pt = snap.forex.point ?? 0.0001;
                setMt5Context({ spread: snap.forex.spread, sessionOpen: snap.forex.sessionOpen, pipValue: snap.forex.pipValue, point: pt, digits: pt <= 0.001 ? 5 : 2 });
            }
            return snap;
        }
        case 'get_order_book':
            return adapter.getOrderBook(input.symbol, input.depth);
        case 'get_recent_trades':
            return adapter.getRecentTrades(input.symbol, input.limit);
        case 'get_open_orders':
            return adapter.getOpenOrders(input.symbol);
        case 'place_order': {
            let requestedQty = input.quantity;
            // ── Lot-size guardrail: clamp to 2× suggested size ──
            const suggested = suggestedLotsByAgent.get(agentKey);
            if (suggested != null && suggested > 0) {
                const maxAllowed = Math.max(0.01, Math.round(suggested * 2 * 100) / 100);
                if (requestedQty > maxAllowed) {
                    logEvent(agentKey, 'warn', 'guardrail_block', `Lot size clamped: agent requested ${requestedQty} lots but max allowed is ${maxAllowed} (2× suggested ${suggested.toFixed(2)}). Using ${maxAllowed}.`);
                    requestedQty = maxAllowed;
                }
                else if (requestedQty < 0.01) {
                    requestedQty = 0.01;
                }
            }
            const params = {
                symbol: input.symbol,
                side: input.side,
                type: input.type,
                quantity: requestedQty,
                price: input.price,
                timeInForce: input.timeInForce,
                stopPips: input.stopPips,
                tpPips: input.tpPips,
            };
            const agentGuardrails = getAgent(agentKey)?.config.guardrails;
            const validation = market === 'mt5'
                ? (() => { const ctx = getMt5Context(); return validateMt5Order(params, ctx.spread, ctx.sessionOpen, ctx.pipValue, agentGuardrails); })()
                : validateOrder(params, params.price ?? 0);
            if (!validation.ok) {
                log.warn({ reason: validation.reason }, 'order blocked by guardrails');
                return { blocked: true, reason: validation.reason };
            }
            if (market === 'mt5' && params.price != null) {
                const ctxPoint = getMt5Context().point;
                const pipSz = pipSize(params.symbol, ctxPoint);
                if (params.stopPips != null) {
                    params.stopPrice = params.side === 'BUY'
                        ? params.price - params.stopPips * pipSz
                        : params.price + params.stopPips * pipSz;
                }
                if (params.tpPips != null) {
                    params.tpPrice = params.side === 'BUY'
                        ? params.price + params.tpPips * pipSz
                        : params.price - params.tpPips * pipSz;
                }
            }
            return adapter.placeOrder(params);
        }
        case 'cancel_order': {
            await adapter.cancelOrder(input.symbol, input.orderId);
            return { cancelled: true };
        }
        case 'close_position': {
            const mt5 = adapter;
            if (typeof mt5.closePosition !== 'function')
                throw new Error('close_position is only supported for MT5');
            return mt5.closePosition(input.ticket, input.volume);
        }
        case 'modify_position': {
            const mt5Adpt = adapter;
            if (typeof mt5Adpt.modifyPosition !== 'function')
                throw new Error('modify_position is only supported for MT5');
            const { ticket, sl, tp } = input;
            const result = await mt5Adpt.modifyPosition(ticket, sl, tp);
            logEvent(agentKey, 'info', 'auto_execute', `modify_position #${ticket} → SL:${sl ?? 'unchanged'} TP:${tp ?? 'unchanged'}`);
            return result;
        }
        case 'save_memory': {
            const { category, key, value, confidence, ttl_hours } = input;
            dbSaveMemory(agentKey, category, key, value, confidence, ttl_hours);
            logEvent(agentKey, 'info', 'memory_write', `Saved memory [${category}] "${key}" (conf ${confidence})`);
            return { ok: true, message: `Memory saved: [${category}] ${key}` };
        }
        case 'read_memories': {
            const { category, limit } = input;
            const memories = dbGetMemories(agentKey, category, limit ?? 10);
            return { memories, count: memories.length };
        }
        case 'delete_memory': {
            const { category, key } = input;
            dbDeleteMemory(agentKey, category, key);
            logEvent(agentKey, 'info', 'memory_write', `Deleted memory [${category}] "${key}"`);
            return { ok: true };
        }
        case 'save_plan': {
            const { market_bias, key_levels, risk_notes, plan_text, session_label } = input;
            const planId = dbSavePlan(agentKey, { marketBias: market_bias, keyLevels: key_levels, riskNotes: risk_notes, planText: plan_text, sessionLabel: session_label, cycleCountAt: getAgent(agentKey)?.cycleCount });
            logEvent(agentKey, 'info', 'plan_created', `Session plan saved [${market_bias.toUpperCase()}] id=${planId}`);
            return { ok: true, planId, message: `Session plan saved with bias: ${market_bias}` };
        }
        case 'get_plan': {
            const plan = dbGetActivePlan(agentKey);
            if (!plan)
                return { plan: null, message: 'No active plan for today. Consider running a planning cycle.' };
            return { plan };
        }
        case 'get_trade_history': {
            if (market !== 'mt5')
                return { error: 'get_trade_history is only available for MT5' };
            const mt5Adpt = adapter;
            const days = input.days ?? 1;
            const limit = input.limit ?? 20;
            const sym = input.symbol;
            const deals = await mt5Adpt.getDeals(sym, days, limit);
            const DEAL_TYPE = { 0: 'BUY', 1: 'SELL', 2: 'BALANCE', 3: 'CREDIT', 4: 'CHARGE', 5: 'CORRECTION', 6: 'BONUS' };
            return deals.map(d => ({
                ticket: d.ticket,
                symbol: d.symbol,
                type: DEAL_TYPE[d.type] ?? `TYPE_${d.type}`,
                volume: d.volume,
                price: d.price,
                profit: d.profit,
                commission: d.commission,
                swap: d.swap,
                comment: d.comment, // "sl" = stopped out, "tp" = take profit, "" = manual/external
                time: d.time,
            }));
        }
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}
// ── Agent Tick (main entry point) ─────────────────────────────────────────────
export async function runAgentTick(config, requestedTickType = 'trading') {
    const agentKey = makeAgentKey(config.market, config.symbol, config.mt5AccountId, config.name);
    if (!tryAcquireCycleLock(agentKey)) {
        logEvent(agentKey, 'warn', 'tick_skip', 'Tick already running — skipped duplicate trigger');
        log.warn({ agentKey }, 'tick already in flight — skipping');
        return;
    }
    try {
        let tickType = requestedTickType;
        // Load or create today's session
        const { session, isNew } = loadOrCreateSession(agentKey);
        const tickNumber = session.tickCount + 1;
        const isFirstTick = session.tickCount === 0;
        if (isNew) {
            logEvent(agentKey, 'info', 'session_start', `New trading session started for ${session.sessionDate} — ${agentKey}`);
        }
        else if (isFirstTick) {
            // Restored from DB (server restart) but no ticks yet today
        }
        // Auto-plan: first tick of each session runs as a planning tick if no plan exists
        if (isFirstTick && tickType === 'trading') {
            const existingPlan = dbGetActivePlan(agentKey);
            if (!existingPlan) {
                logEvent(agentKey, 'info', 'auto_plan', `No plan for today — running planning tick first`);
                tickType = 'planning';
            }
        }
        // Check for queued plan request (from UI Plan button while agent is running)
        if (tickType === 'trading' && consumePlanRequest(agentKey)) {
            logEvent(agentKey, 'info', 'auto_plan', `Queued planning request consumed — running planning tick`);
            tickType = 'planning';
        }
        logEvent(agentKey, 'info', 'tick_start', `Tick #${tickNumber} starting for ${config.symbol} (${config.market})${tickType === 'planning' ? ' [PLANNING]' : ''}`);
        log.info({ symbol: config.symbol, market: config.market, tickNumber }, 'agent tick start');
        // Pre-fetch snapshot on EVERY tick — inject summary so LLM has current data immediately
        const agentClosedTickets = new Set();
        let tickUserMessage;
        try {
            const snap = await dispatchTool('get_snapshot', { symbol: config.symbol, market: config.market }, config.market, config.mt5AccountId, agentKey);
            let externalCloseNote = '';
            if (config.market === 'mt5') {
                const positions = (snap.positions ?? []);
                if (isFirstTick) {
                    // Seed lastKnownPositions on tick #1 — nothing to compare yet
                    lastKnownPositions.set(agentKey, new Map(positions.map(p => [p.ticket, p])));
                }
                else {
                    externalCloseNote = await detectExternalCloses(agentKey, config, positions, agentClosedTickets);
                }
                // Fetch today's closed deals and attach to snap so formatSnapshotSummary can render them.
                // This lets the agent see stopped-out / TP'd trades on the very next tick without a tool call.
                try {
                    const mt5Adpt = getAdapter('mt5', config.mt5AccountId);
                    const deals = await mt5Adpt.getDeals(config.symbol, 1, 20);
                    if (deals.length > 0)
                        snap.recentDeals = deals;
                }
                catch { /* non-fatal — omit section if bridge is slow */ }
                // Override snap.risk with per-agent budget derived from config.maxLossUsd and today's deals P&L
                if (config.market === 'mt5') {
                    const deals = snap.recentDeals ?? [];
                    const todayPnl = deals
                        .filter(d => d.type === 0 || d.type === 1) // BUY/SELL deals only (no balance/credit)
                        .reduce((sum, d) => sum + (d.profit ?? 0), 0);
                    snap.risk = {
                        dailyPnlUsd: todayPnl,
                        remainingBudgetUsd: snap.risk?.remainingBudgetUsd ?? 0,
                        positionNotionalUsd: snap.risk?.positionNotionalUsd ?? 0,
                    };
                    // ── Daily loss guard — auto-pause if limit exceeded ────────────────
                    if (config.maxDailyLossUsd != null && todayPnl <= -Math.abs(config.maxDailyLossUsd)) {
                        logEvent(agentKey, 'warn', 'guardrail_block', `Daily loss limit hit: today P&L $${todayPnl.toFixed(2)} ≤ -$${config.maxDailyLossUsd}. Agent paused.`);
                        setAgentStatus(agentKey, 'paused');
                        return; // exits the tick; releaseCycleLock runs in finally
                    }
                    // ── Drawdown guard — auto-pause if equity drops X% below peak ─────
                    if (config.maxDrawdownPercent != null) {
                        const accountInfo = snap.accountInfo;
                        const equity = accountInfo?.equity;
                        if (equity != null) {
                            const prevPeak = peakEquityByAgent.get(agentKey) ?? equity;
                            const peak = Math.max(prevPeak, equity);
                            peakEquityByAgent.set(agentKey, peak);
                            const drawdownPct = peak > 0 ? (peak - equity) / peak * 100 : 0;
                            if (drawdownPct >= config.maxDrawdownPercent) {
                                logEvent(agentKey, 'warn', 'guardrail_block', `Drawdown limit hit: ${drawdownPct.toFixed(1)}% drawdown — equity $${equity.toFixed(2)} vs peak $${peak.toFixed(2)}. Agent paused.`);
                                setAgentStatus(agentKey, 'paused');
                                return;
                            }
                        }
                    }
                }
            }
            // ── Monte Carlo simulation ─────────────────────────────────────────────
            // Pure math — runs synchronously in <50ms. Zero LLM involvement.
            let mcResult;
            try {
                const snapCandles = snap.candles;
                const snapInds = snap.indicators;
                const snapFx = snap.forex;
                const snapAcct = snap.accountInfo;
                const snapPrice = snap.price;
                // Derive suggested lot size from the sizing block (already computed in formatSnapshotSummary)
                const equity = snapAcct?.equity ?? 0;
                const pipSz = snapFx?.pipSize ?? 1;
                const pipVal = snapFx?.pipValue ?? 0;
                const atr14 = snapInds?.atr14 ?? 0;
                const maxRiskPct = config?.maxRiskPercent ?? 10;
                const maxRiskUsd = equity * (maxRiskPct / 100);
                const slPips = atr14 > 0 && pipSz > 0 ? (atr14 / pipSz) * 1.0 : 0;
                const riskPerLot = slPips * pipVal;
                const suggestedLots = riskPerLot > 0
                    ? Math.max(0.01, Math.floor((maxRiskUsd / riskPerLot) * 100) / 100)
                    : 0.01;
                if (snapCandles?.m1 && snapInds && snapPrice?.last && suggestedLots > 0) {
                    const mc = runMonteCarlo({
                        m1: (snapCandles.m1 ?? []),
                        m5: (snapCandles.m5 ?? []),
                        m15: (snapCandles.m15 ?? []),
                        m30: (snapCandles.m30 ?? []),
                        h1: (snapCandles.h1 ?? []),
                        h4: (snapCandles.h4 ?? []),
                        currentPrice: snapPrice.last,
                        pipSize: pipSz,
                        pipValue: pipVal,
                        lotSize: suggestedLots,
                        atr14,
                        ema20: snapInds.ema20 ?? 0,
                        ema50: snapInds.ema50 ?? 0,
                    });
                    if (mc) {
                        mcResult = mc;
                        // Log MC result so it appears in the Logs panel per tick
                        logEvent(agentKey, 'info', 'mc_result', `MC: LONG win=${mc.long.winRate.toFixed(1)}% EV=${mc.long.ev >= 0 ? '+' : ''}$${mc.long.ev.toFixed(0)} | SHORT win=${mc.short.winRate.toFixed(1)}% EV=${mc.short.ev >= 0 ? '+' : ''}$${mc.short.ev.toFixed(0)} | Recommended: ${mc.recommended}`, { long: mc.long, short: mc.short, recommended: mc.recommended, edgeDelta: mc.edgeDelta, pathCount: mc.pathCount, barsForward: mc.barsForward });
                    }
                }
            }
            catch { /* MC is non-fatal — agent continues without it */ }
            const summary = formatSnapshotSummary(snap, agentKey, config, mcResult);
            // Fetch recent forex news (non-blocking, fails silently)
            let newsItems;
            if (config.market === 'mt5') {
                newsItems = await fetchForexNews(config.symbol).catch(() => undefined);
            }
            tickUserMessage = buildTickMessage(config, agentKey, tickNumber, isFirstTick, tickType, summary, externalCloseNote, newsItems);
        }
        catch (prefetchErr) {
            const msg = prefetchErr instanceof Error ? prefetchErr.message : String(prefetchErr);
            log.warn({ err: msg }, 'snapshot pre-fetch failed — LLM will call get_snapshot manually');
            tickUserMessage = buildTickMessage(config, agentKey, tickNumber, isFirstTick, tickType);
        }
        // Append the tick message to the session conversation
        session.messages.push({ role: 'user', content: tickUserMessage });
        const systemPrompt = buildSystemPrompt(config, agentKey, session.summary);
        const llmProvider = getLLMProvider(config);
        const llmModel = getModelForConfig(config);
        // Each tick may need: planning calls + get_snapshot + indicators + place_order + confirm
        // Minimum realistic: 6 calls. Default 15 gives ample room without runaway loops.
        const MAX_ITERATIONS = parseInt(process.env.MAX_CYCLE_ITERATIONS ?? '15', 10);
        let iterations = 0;
        let orderPlacedThisTick = false;
        let tickPnlUsd = 0;
        try {
            while (true) {
                iterations++;
                if (iterations > MAX_ITERATIONS) {
                    logEvent(agentKey, 'warn', 'tick_error', `⚠ Tick aborted — exceeded ${MAX_ITERATIONS} iterations. Check for order state confusion.`);
                    recordCycle(agentKey, { symbol: config.symbol, market: config.market, paper: false, decision: 'HOLD', reason: `Aborted after ${MAX_ITERATIONS} iterations`, time: new Date().toISOString() });
                    return;
                }
                const providerLabel = config.llmProvider === 'openrouter' ? `OpenRouter/${llmModel}` : `Anthropic/${llmModel}`;
                logEvent(agentKey, 'debug', 'llm_request', `Sending to ${providerLabel} (tick #${tickNumber}, iteration ${iterations})`);
                // ── LLM Payload Console Log ──────────────────────────────────────────
                console.log('\n' + '═'.repeat(80));
                console.log(`🤖 LLM REQUEST  agent=${agentKey}  tick=#${tickNumber}  iter=${iterations}  model=${llmModel}`);
                console.log('─'.repeat(80));
                console.log('📋 SYSTEM PROMPT:');
                console.log(systemPrompt);
                console.log('─'.repeat(80));
                console.log(`💬 MESSAGES (${session.messages.length} total):`);
                session.messages.forEach((msg, i) => {
                    const content = typeof msg.content === 'string'
                        ? msg.content
                        : JSON.stringify(msg.content, null, 2);
                    console.log(`  [${i}] ${msg.role.toUpperCase()}: ${content.slice(0, 500)}${content.length > 500 ? '…' : ''}`);
                });
                console.log('═'.repeat(80) + '\n');
                // ─────────────────────────────────────────────────────────────────────
                const response = await llmProvider.createMessage({
                    model: llmModel,
                    max_tokens: 4096,
                    system: systemPrompt,
                    tools: getTools(config.market, tickType),
                    messages: session.messages,
                });
                log.debug({ stop_reason: response.stop_reason, usage: response.usage }, 'llm response');
                session.messages.push({ role: 'assistant', content: response.content });
                if (response.stop_reason === 'end_turn') {
                    const text = response.content
                        .filter((b) => b.type === 'text')
                        .map(b => b.text)
                        .join('\n');
                    // Log the model's reasoning (strip DECISION/REASON lines for the thinking log)
                    const thinkingText = text.replace(/^DECISION:.*$/gim, '').replace(/^REASON:.*$/gim, '').trim();
                    if (thinkingText) {
                        logEvent(agentKey, 'info', 'claude_thinking', thinkingText);
                    }
                    else if (!text.trim()) {
                        logEvent(agentKey, 'warn', 'claude_thinking', '(model returned no reasoning text — consider switching to a stronger model)');
                    }
                    const decMatch = text.match(/DECISION:\s*(.+)/i);
                    const reasonMatch = text.match(/REASON:\s*(.+)/i);
                    // Strip markdown bold (**), collapse whitespace, cap at 300 chars so DB field stays clean
                    const cleanField = (s) => s.replace(/\*+/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
                    let decision;
                    if (decMatch) {
                        decision = cleanField(decMatch[1]);
                    }
                    else if (orderPlacedThisTick) {
                        // Agent used place_order tool but didn't write formal DECISION line
                        decision = 'EXECUTED (via tool)';
                    }
                    else {
                        // Try to infer from freeform text
                        const lower = text.toLowerCase();
                        if (/\b(hold|wait|no trade|stand aside|skip|no action)\b/.test(lower)) {
                            decision = 'HOLD';
                        }
                        else if (/\b(buy|long|bought)\b/.test(lower) && /\b(sell|short|sold)\b/.test(lower)) {
                            decision = 'HOLD'; // contradictory — treat as hold
                        }
                        else if (/\b(bought|opened.*long|placed.*buy)\b/.test(lower)) {
                            decision = 'BUY (inferred)';
                        }
                        else if (/\b(sold|opened.*short|placed.*sell)\b/.test(lower)) {
                            decision = 'SELL (inferred)';
                        }
                        else if (/\b(closed|exited|took profit|stopped out)\b/.test(lower)) {
                            decision = 'CLOSE (inferred)';
                        }
                        else {
                            decision = 'HOLD';
                        }
                    }
                    // Extract reason — fall back to first meaningful sentence if no REASON: line
                    let reason;
                    if (reasonMatch) {
                        reason = cleanField(reasonMatch[1]);
                    }
                    else {
                        const firstSentence = text.split(/[.\n]/).find(s => s.trim().length > 15);
                        reason = firstSentence ? cleanField(firstSentence) : '';
                    }
                    logEvent(agentKey, 'info', 'decision', `DECISION: ${decision}${reason ? ` — ${reason}` : ''}`);
                    log.info({ decision, tickNumber }, 'tick complete');
                    // Auto-execute safety net
                    if (!orderPlacedThisTick) {
                        // Match: BUY [LIMIT|STOP|MARKET]? qty @ price
                        const buyMatch = decision.match(/^BUY\s+(?:LIMIT\s+|STOP\s+|MARKET\s+)?([\d.]+)\s+@\s+([\d.]+)/i);
                        const sellMatch = decision.match(/^SELL\s+(?:LIMIT\s+|STOP\s+|MARKET\s+)?([\d.]+)\s+@\s+([\d.]+)/i);
                        const cancelMatch = decision.match(/^CANCEL\s+(\d+)/i);
                        if (buyMatch || sellMatch) {
                            const match = (buyMatch ?? sellMatch);
                            const side = buyMatch ? 'BUY' : 'SELL';
                            const qty = parseFloat(match[1]);
                            const price = parseFloat(match[2]);
                            const isLimit = /\b(LIMIT|STOP)\b/i.test(decision);
                            const orderType = /\bSTOP\b/i.test(decision) ? 'STOP' : isLimit ? 'LIMIT' : 'MARKET';
                            // Try to parse explicit SL and TP from decision (e.g. "SL: 159.50 TP: 162.00")
                            const slMatch = decision.match(/\bSL:\s*([\d.]+)/i);
                            const tpMatch = decision.match(/\bTP:\s*([\d.]+)/i);
                            const slPrice = slMatch ? parseFloat(slMatch[1]) : null;
                            const tpPrice = tpMatch ? parseFloat(tpMatch[1]) : null;
                            const pip = pipSize(config.symbol, getMt5Context().point);
                            const stopPips = slPrice != null ? Math.round(Math.abs(price - slPrice) / pip) : 20;
                            const tpPips = tpPrice != null ? Math.round(Math.abs(tpPrice - price) / pip) : undefined;
                            logEvent(agentKey, 'warn', 'auto_execute', `Agent stated ${side} ${orderType} without calling place_order — auto-executing @ ${price} SL ${stopPips}pip${tpPips ? ` TP ${tpPips}pip` : ''}`);
                            try {
                                const result = await dispatchTool('place_order', {
                                    symbol: config.symbol, market: config.market,
                                    side, type: orderType, quantity: qty, price, stopPips, ...(tpPips != null ? { tpPips } : {}),
                                }, config.market, config.mt5AccountId, agentKey);
                                logEvent(agentKey, 'info', 'tool_result', `← auto place_order: ${summariseToolResult('place_order', result)}`);
                            }
                            catch (autoErr) {
                                logEvent(agentKey, 'error', 'auto_execute_error', `Auto-execute failed: ${autoErr instanceof Error ? autoErr.message : String(autoErr)}`);
                            }
                        }
                        else if (cancelMatch) {
                            const orderId = parseInt(cancelMatch[1], 10);
                            logEvent(agentKey, 'warn', 'auto_execute', `Agent stated CANCEL without calling cancel_order — auto-executing`);
                            try {
                                await dispatchTool('cancel_order', { symbol: config.symbol, market: config.market, orderId }, config.market, config.mt5AccountId, agentKey);
                                logEvent(agentKey, 'info', 'tool_result', '← auto cancel_order: cancelled');
                            }
                            catch (autoErr) {
                                logEvent(agentKey, 'error', 'auto_execute_error', `Auto-cancel failed: ${autoErr instanceof Error ? autoErr.message : String(autoErr)}`);
                            }
                        }
                        else {
                            const closeMatch = decision.match(/^CLOSE\s+(\d+)/i);
                            if (closeMatch) {
                                const ticket = parseInt(closeMatch[1], 10);
                                logEvent(agentKey, 'warn', 'auto_execute', `Agent stated CLOSE without calling close_position — auto-executing ticket ${ticket}`);
                                try {
                                    const result = await dispatchTool('close_position', { ticket, market: config.market }, config.market, config.mt5AccountId, agentKey);
                                    logEvent(agentKey, 'info', 'tool_result', `← auto close_position: ${summariseToolResult('close_position', result)}`);
                                }
                                catch (autoErr) {
                                    logEvent(agentKey, 'error', 'auto_execute_error', `Auto-close failed: ${autoErr instanceof Error ? autoErr.message : String(autoErr)}`);
                                }
                            }
                        }
                    }
                    recordCycle(agentKey, { symbol: config.symbol, market: config.market, paper: false, decision, reason, time: new Date().toISOString(), mt5AccountId: config.mt5AccountId, ...(tickPnlUsd !== 0 ? { pnlUsd: tickPnlUsd } : {}) });
                    break;
                }
                if (response.stop_reason === 'tool_use') {
                    // Log any reasoning text the model included alongside tool calls
                    const reasoningText = response.content
                        .filter((b) => b.type === 'text')
                        .map(b => b.text.trim())
                        .filter(t => t.length > 0)
                        .join('\n');
                    if (reasoningText) {
                        logEvent(agentKey, 'info', 'claude_thinking', reasoningText);
                    }
                    const toolResults = [];
                    for (const block of response.content) {
                        if (block.type !== 'tool_use')
                            continue;
                        const inputSummary = Object.entries(block.input)
                            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                            .join(' ');
                        logEvent(agentKey, 'info', 'tool_call', `→ ${block.name}(${inputSummary})`);
                        log.info({ tool: block.name, input: block.input }, 'tool call');
                        if (block.name === 'place_order' || block.name === 'cancel_order' || block.name === 'close_position') {
                            orderPlacedThisTick = true;
                        }
                        let result;
                        try {
                            result = await dispatchTool(block.name, block.input, config.market, config.mt5AccountId, agentKey);
                            logEvent(agentKey, 'info', 'tool_result', `← ${block.name}: ${summariseToolResult(block.name, result)}`);
                        }
                        catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            logEvent(agentKey, 'error', 'tool_error', `← ${block.name} ERROR: ${msg}`);
                            log.error({ tool: block.name, err: msg }, 'tool error');
                            result = { error: msg };
                        }
                        // Strip candles from snapshot history to save tokens
                        let resultForHistory = block.name === 'get_snapshot' && result != null
                            ? { ...result, candles: undefined }
                            : result;
                        // Warn LLM when a limit order FILLS — don't call cancel_order on it
                        if (block.name === 'place_order' && result != null) {
                            const o = result;
                            if (o.status === 'FILLED' && o.orderId != null) {
                                resultForHistory = {
                                    ...resultForHistory,
                                    _important: `✅ ORDER FILLED — ticket #${o.orderId} is now an OPEN POSITION. Do NOT call cancel_order on this ticket. If you want to exit, use close_position(ticket=${o.orderId}).`,
                                };
                            }
                        }
                        // Track closed tickets and update lastKnownPositions immediately
                        if (block.name === 'close_position' && result != null) {
                            const r = result;
                            if (r.closed && r.ticket != null) {
                                agentClosedTickets.add(r.ticket);
                                // Proactively remove from lastKnownPositions so next tick's pre-fetch
                                // doesn't falsely detect it as an external close
                                const knownPos = lastKnownPositions.get(agentKey);
                                if (knownPos)
                                    knownPos.delete(r.ticket);
                                // Fetch P&L for this close from trade history
                                if (config.market === 'mt5' && r.dealTicket != null) {
                                    try {
                                        const mt5Adpt = getAdapter('mt5', config.mt5AccountId);
                                        const deals = await mt5Adpt.getDeals(config.symbol, 1, 10);
                                        const closeDeal = deals.find(d => d.ticket === r.dealTicket);
                                        if (closeDeal) {
                                            const pnl = (closeDeal.profit ?? 0) + (closeDeal.commission ?? 0) + (closeDeal.swap ?? 0);
                                            tickPnlUsd += pnl;
                                            logEvent(agentKey, 'info', 'pnl_record', `Close ticket #${r.ticket} → P&L $${pnl.toFixed(2)} (deal #${r.dealTicket})`);
                                        }
                                    }
                                    catch (pnlErr) {
                                        logEvent(agentKey, 'warn', 'pnl_record', `Failed to fetch P&L for deal #${r.dealTicket}: ${pnlErr instanceof Error ? pnlErr.message : String(pnlErr)}`);
                                    }
                                }
                            }
                        }
                        // Guard: block cancel_order on known open position tickets
                        if (block.name === 'cancel_order') {
                            const inp = block.input;
                            const ticketToCancel = inp.orderId ?? inp.ticket;
                            const knownPos = lastKnownPositions.get(agentKey);
                            if (ticketToCancel != null && knownPos?.has(ticketToCancel)) {
                                const pos = knownPos.get(ticketToCancel);
                                const errMsg = `⛔ Cannot cancel: #${ticketToCancel} is an OPEN POSITION (${pos.side} ${pos.volume} lot @ ${pos.priceOpen}). Use close_position(ticket=${ticketToCancel}) to close it.`;
                                logEvent(agentKey, 'warn', 'guardrail_block', errMsg);
                                resultForHistory = { error: errMsg };
                                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultForHistory) });
                                continue;
                            }
                        }
                        // Detect externally closed positions (when LLM calls get_snapshot)
                        if (block.name === 'get_snapshot' && config.market === 'mt5' && result != null) {
                            const snap = result;
                            if (Array.isArray(snap.positions)) {
                                const externalNote = await detectExternalCloses(agentKey, config, snap.positions, agentClosedTickets);
                                if (externalNote) {
                                    resultForHistory = { ...resultForHistory, _externalCloses: externalNote.trim() };
                                }
                            }
                        }
                        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultForHistory) });
                    }
                    session.messages.push({ role: 'user', content: toolResults });
                    continue;
                }
                logEvent(agentKey, 'warn', 'tick_end', `Unexpected stop reason: ${response.stop_reason}`);
                break;
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Rate limit: emergency stop + close all open positions
            if (err instanceof RateLimitError || (err instanceof Error && (err.message.includes('429') || err.message.toLowerCase().includes('rate limit')))) {
                const resetMsg = (err instanceof RateLimitError && err.resetAt)
                    ? ` Resets at ${new Date(err.resetAt).toISOString()}.`
                    : '';
                logEvent(agentKey, 'error', 'tick_error', `⚠ Rate limit hit — emergency stopping agent and closing all open positions.${resetMsg}`);
                try {
                    const { stopAgentSchedule } = await import('../scheduler/index.js');
                    stopAgentSchedule(agentKey);
                }
                catch (schedErr) {
                    log.error({ schedErr }, 'failed to stop agent schedule during rate-limit emergency');
                }
                try {
                    const openOrders = await dispatchTool('get_open_orders', { symbol: config.symbol }, config.market, config.mt5AccountId, agentKey);
                    if (Array.isArray(openOrders) && openOrders.length > 0) {
                        logEvent(agentKey, 'warn', 'tick_error', `Emergency closing ${openOrders.length} open position(s)…`);
                        for (const order of openOrders) {
                            try {
                                if (config.market === 'mt5') {
                                    const result = await dispatchTool('close_position', { ticket: order.orderId, market: config.market }, config.market, config.mt5AccountId, agentKey);
                                    logEvent(agentKey, 'warn', 'tool_result', `← Emergency close_position: ${summariseToolResult('close_position', result)}`);
                                }
                                else {
                                    await dispatchTool('cancel_order', { symbol: config.symbol, market: config.market, orderId: order.orderId }, config.market, config.mt5AccountId, agentKey);
                                    logEvent(agentKey, 'warn', 'tool_result', `← Emergency cancel_order orderId=${order.orderId}: cancelled`);
                                }
                            }
                            catch (closeErr) {
                                logEvent(agentKey, 'error', 'tick_error', `Emergency close failed for orderId=${order.orderId}: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}`);
                            }
                        }
                    }
                }
                catch (fetchErr) {
                    logEvent(agentKey, 'error', 'tick_error', `Could not fetch open orders for emergency close: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
                }
                recordCycle(agentKey, { symbol: config.symbol, market: config.market, paper: false, decision: 'EMERGENCY_STOP', reason: `Rate limit: ${msg}`, time: new Date().toISOString(), error: msg });
                return;
            }
            // Quota / billing / no credits: pause agent, don't close positions (no emergency)
            const isQuotaError = ((err instanceof Error && (err.message.includes('402') ||
                err.message.toLowerCase().includes('insufficient') ||
                err.message.toLowerCase().includes('quota') ||
                err.message.toLowerCase().includes('billing') ||
                err.message.toLowerCase().includes('no credits') ||
                err.message.toLowerCase().includes('credit') ||
                err.message.toLowerCase().includes('payment') ||
                err.message.toLowerCase().includes('out of tokens') ||
                err.message.toLowerCase().includes('token limit') ||
                err.message.toLowerCase().includes('usage limit'))) ||
                (typeof err.status === 'number' && err.status === 402));
            if (isQuotaError) {
                const reason = `⚠ API quota/billing issue — agent paused. Top up credits or check your API key. (${msg})`;
                logEvent(agentKey, 'error', 'quota_error', reason);
                setAgentPaused(agentKey, reason);
                try {
                    const { stopAgentSchedule } = await import('../scheduler/index.js');
                    stopAgentSchedule(agentKey);
                }
                catch { /* ignore */ }
                recordCycle(agentKey, { symbol: config.symbol, market: config.market, paper: false, decision: 'ERROR', reason, time: new Date().toISOString(), error: msg });
                return;
            }
            logEvent(agentKey, 'error', 'tick_error', `Tick failed: ${msg}`);
            log.error({ err: msg }, 'agent tick crashed');
            recordCycle(agentKey, { symbol: config.symbol, market: config.market, paper: false, decision: 'ERROR', reason: msg, time: new Date().toISOString(), error: msg });
        }
        // ── Compress session if it's grown too long ───────────────────────────────
        if (session.messages.length > KEEP_MESSAGES) {
            const cutPoint = findTickBoundaryCutPoint(session.messages, KEEP_MESSAGES);
            if (cutPoint > 0) {
                const toCompress = session.messages.slice(0, cutPoint);
                const newSummary = compressToSummary(toCompress);
                session.summary = session.summary ? `${session.summary}\n${newSummary}` : newSummary;
                session.messages = session.messages.slice(cutPoint);
                // messages[0] is now guaranteed to be a string user message (tick boundary)
            }
        }
        // ── Persist session to DB ─────────────────────────────────────────────────
        session.tickCount++;
        activeSessions.set(agentKey, session);
        dbSaveSession(agentKey, {
            sessionDate: session.sessionDate,
            tickCount: session.tickCount,
            messages: session.messages,
            summary: session.summary,
        });
        logEvent(agentKey, 'info', 'tick_end', `Tick #${tickNumber} complete | session has ${session.messages.length} messages | ${session.tickCount} ticks today`);
    }
    finally {
        releaseCycleLock(agentKey);
    }
}
// Backward-compat alias — scheduler and server will be updated to call runAgentTick directly
export const runAgentCycle = runAgentTick;
//# sourceMappingURL=index.js.map