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
import { getTools } from '../tools/definitions.js';
import { recordCycle, logEvent, tryAcquireCycleLock, releaseCycleLock, getAgent, setAgentStatus } from '../server/state.js';
import { dbGetAgentPerformance, makeAgentKey, dbSaveMemory, dbGetMemories, dbDeleteMemory, dbSavePlan, dbGetActivePlan, dbGetStrategy, dbGetTodaySession, dbSaveSession, } from '../db/index.js';
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
    // Brand new session
    const session = { sessionDate: today, messages: [], tickCount: 0, summary: null };
    activeSessions.set(agentKey, session);
    return { session, isNew: true };
}
const lastKnownPositions = new Map();
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
// pip = 0.0001 for 4/5-dp symbols, 0.01 for 2/3-dp symbols.
function formatAtr(atr, dp) {
    const pipSize = dp >= 4 ? 0.0001 : 0.01;
    const pips = atr / pipSize;
    return `${atr.toFixed(dp)} (${pips.toFixed(1)} pips)`;
}
function candleTrendLine(candles, count, dp) {
    const bars = candles.slice(-count);
    return bars.map(c => `${c.close.toFixed(dp)}${c.close >= c.open ? '▲' : '▼'}`).join(' ');
}
function formatSnapshotSummary(snap) {
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
    if (accountInfo?.equity != null) {
        const lev = accountInfo.leverage ? `1:${accountInfo.leverage}` : '?';
        lines.push(`Account: Balance $${accountInfo.balance?.toFixed(2) ?? '?'} | Equity $${accountInfo.equity.toFixed(2)} | Free Margin $${accountInfo.freeMargin?.toFixed(2) ?? '?'} | Leverage ${lev}`);
    }
    if (price) {
        lines.push(`Price: ${price.last?.toFixed(dp)} | Bid: ${price.bid?.toFixed(dp)} | Ask: ${price.ask?.toFixed(dp)}`);
    }
    if (forex) {
        lines.push(`Spread: ${forex.spread?.toFixed(1)} pips | Session: ${forex.sessionOpen ? 'OPEN' : 'CLOSED'}`);
    }
    if (indicators) {
        const parts = [];
        if (indicators.rsi14 != null)
            parts.push(`RSI14: ${indicators.rsi14.toFixed(1)}`);
        if (indicators.ema20 != null)
            parts.push(`EMA20: ${indicators.ema20.toFixed(dp)}`);
        if (indicators.ema50 != null)
            parts.push(`EMA50: ${indicators.ema50.toFixed(dp)}`);
        if (indicators.atr14 != null)
            parts.push(`ATR14: ${formatAtr(indicators.atr14, dp)}`);
        if (parts.length > 0)
            lines.push(parts.join(' | '));
    }
    // Multi-timeframe candle trend — compact bar-by-bar read
    if (candles?.h4 && candles.h4.length >= 3) {
        lines.push(`H4 (last 3 bars): ${candleTrendLine(candles.h4, 3, dp)}`);
    }
    if (candles?.h1 && candles.h1.length >= 5) {
        lines.push(`H1 (last 5 bars): ${candleTrendLine(candles.h1, 5, dp)}`);
    }
    // Dynamic position sizing hint — 1% risk rule with ATR-based stop
    if (forex?.pipValue != null && forex?.point != null && forex.point > 0
        && accountInfo?.equity != null && indicators?.atr14 != null) {
        const contractSize = forex.pipValue / forex.point;
        const riskUsd = accountInfo.equity * 0.01;
        const stopCostPerLot = indicators.atr14 * 1.5 * contractSize;
        const suggestedLots = stopCostPerLot > 0
            ? Math.max(0.01, Math.floor((riskUsd / stopCostPerLot) * 100) / 100)
            : 0.01;
        lines.push(`Sizing (1% risk $${riskUsd.toFixed(0)}, ATR×1.5 stop ~$${stopCostPerLot.toFixed(0)}/lot): suggested ${suggestedLots.toFixed(2)} lots`);
    }
    if (positions && positions.length > 0) {
        lines.push(`OPEN POSITIONS (${positions.length}):`);
        for (const p of positions) {
            lines.push(`  #${p.ticket} ${p.side} ${p.volume} @ ${p.priceOpen.toFixed(dp)} | now: ${p.priceCurrent.toFixed(dp)} | P&L: $${p.profit.toFixed(2)} | SL: ${p.sl?.toFixed(dp) ?? 'none'} TP: ${p.tp?.toFixed(dp) ?? 'none'}`);
        }
    }
    else {
        lines.push('Open Positions: none');
    }
    if (pendingOrders && pendingOrders.length > 0) {
        lines.push(`Pending Orders (${pendingOrders.length}):`);
        for (const o of pendingOrders) {
            lines.push(`  #${o.ticket} ${o.type} ${o.volume} @ ${o.priceTarget.toFixed(dp)} | SL: ${o.sl?.toFixed(dp) ?? 'none'} TP: ${o.tp?.toFixed(dp) ?? 'none'}`);
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
            lines.push(`Closed trades today (${tradingDeals.length}):`);
            for (const d of tradingDeals.slice(0, 8)) {
                const dir = DEAL_TYPE[d.type] ?? `TYPE${d.type}`;
                const pnl = d.profit >= 0 ? `+$${d.profit.toFixed(2)}` : `-$${Math.abs(d.profit).toFixed(2)}`;
                const exit = d.comment ? ` [${d.comment}]` : '';
                const t = new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                lines.push(`  #${d.ticket} ${dir} ${d.volume} @ ${d.price.toFixed(dp)} | P&L: ${pnl}${exit} at ${t}`);
            }
        }
    }
    return lines.join('\n');
}
// ── Session compression ───────────────────────────────────────────────────────
const KEEP_MESSAGES = 20;
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
                    lines.push(`• ${decMatch[1].trim()}${reasonMatch ? ` — ${reasonMatch[1].trim()}` : ''}`);
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
        ? `\n\nYOUR RECENT PERFORMANCE (last ${perf.totalCycles} ticks on ${symbol}):\n- Decisions: BUY ${perf.buys} | SELL ${perf.sells} | HOLD ${perf.holds}\n- Last decisions: ${perf.lastDecisions.map(d => `[${d.time.slice(11, 16)}] ${d.decision.split(' ')[0]}`).join(' → ')}${perf.holds >= 5 && perf.buys === 0 && perf.sells === 0 ? '\nWARNING: You have held every recent tick. Re-examine if conditions truly warrant inaction or if you are being overly cautious.' : ''}`
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
MT5 SESSION RULES: Only trade during Tokyo, London, or New York sessions. Reject entries when sessionOpen is false. The live spread is shown in the snapshot summary each tick — weigh it as a cost factor in your entry decision (wider spread = smaller effective profit). Only skip an entry if spread appears clearly abnormal (e.g. 10x typical).
MT5 provides real swap rates in the snapshot — factor overnight costs into hold decisions for multi-day positions.

MT5 POSITION & ORDER MANAGEMENT (critical):
The snapshot contains TWO important arrays — read both before deciding:
  positions[] — your currently open trades. Each has: ticket, side, volume, priceOpen, priceCurrent, profit (unrealised), sl, tp, swap.
  pendingOrders[] — your pending limit/stop orders not yet filled. Each has: ticket, type (BUY_LIMIT/SELL_LIMIT/BUY_STOP/SELL_STOP), volume, priceTarget, sl, tp.

Rules:
- To CLOSE an open position: call close_position(ticket). NEVER place an opposite-side order — it opens a second position.
- To TRAIL or adjust SL/TP: call modify_position(ticket, sl, tp). Use this to move SL to breakeven once in profit, or tighten TP as target nears.
- To CANCEL a pending order: call cancel_order(ticket). Do this if the order is no longer valid given current price/indicators.
- Do not open a new position if one is already open for this symbol (unless pyramiding is justified by strong signal).
- Do not place a duplicate pending order if one already exists at the same price level.
- If a position shows negative profit approaching sl: decide whether to close early or hold.
- If pendingOrders is empty and price is near a key level, consider placing a limit order for better entry.`
        : '';
    const leverageContent = config.leverage
        ? `Account leverage: 1:${config.leverage} — use this to calculate required margin: margin = (volume × contractSize × price) ÷ leverage. For XAUUSD at $4900 with 100oz contract and 1:500 leverage: 0.01 lots = ($4900 × 100 × 0.01) ÷ 500 = $9.80 margin required`
        : '';
    const riskRulesContent = `RISK RULES (non-negotiable):
- Lot size: each tick message shows a "Sizing" line with the 1%-risk suggested lot size. Use it. Default to 0.01 if no sizing line.
- Stop distance: ATR14 × 1.5 minimum. Never tighter — broker can stop you out on spread.
- Once a position profits by 1× ATR, call modify_position to move SL to breakeven.
- You MAY add to a winning position (same direction) if RSI confirms and total lots stay within 2× the suggested size.
- Close losers at your stop — do not widen stops to avoid a loss.`;
    const outputFormatContent = `EXECUTION RULES (mandatory — the DECISION line does NOT trigger a trade by itself):
- If BUY or SELL: call place_order FIRST, then write the DECISION line.
- If CLOSE: call close_position(ticket) FIRST, then write the DECISION line.
- If CANCEL: call cancel_order FIRST, then write the DECISION line.
- If HOLD: do NOT call any order tool. Just write the DECISION line.
- Always include stopPips on place_order (use ATR14 × 1.5 as minimum distance).

DECISION FORMAT (write AFTER executing the tool call):
DECISION: [HOLD | BUY <qty> @ <price> | SELL <qty> @ <price> | CLOSE <ticket> | CANCEL <orderId>]
REASON: <1-2 sentences of evidence>`;
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

ROLE: Disciplined, risk-first algorithmic trader. You run as a continuous session — each tick you receive a market update and decide what to do next. You remember your full conversation history from earlier ticks today.

PROCESS:
1. Review your conversation history — you remember every decision made in this session today.
2. Each tick message includes an auto-fetched market snapshot (price, indicators, positions). Use it directly.
3. Call get_snapshot only if you need candle data or more granular detail not in the summary.
4. Reason through evidence: trend (EMA cross), momentum (RSI), volatility (ATR, BB width), context signals.
5. Decide: HOLD / BUY qty @ price / SELL qty @ price / CLOSE ticket / CANCEL orderId.
6. Execute via place_order, close_position, or cancel_order. Always prefer LIMIT orders for entries.
${market === 'mt5' ? '7. MT5: always include stopPips on every new order (ATR-based distance).\n' : ''}${leverageContent ? `\nACCOUNT CONFIG:\n- ${leverageContent}\n` : ''}
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
function buildTickMessage(config, tickNumber, isFirstTick, tickType, snapshotSummary, externalCloseNote, newsItems) {
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
        ? `\n\n⚠ EXTERNALLY CLOSED POSITIONS (since last tick):\n${externalCloseNote}\nDo NOT attempt to close these tickets — they no longer exist.`
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
EVALUATION ORDER:
1. OPEN POSITIONS — if any open: check P&L vs stop; close if sl breached or trade thesis broken;
   use modify_position to move SL to breakeven once P&L > ATR14, or to trail stop as price extends
2. PENDING ORDERS — cancel any limit/stop orders that are no longer valid given current price
3. TREND — EMA20 vs EMA50 alignment gives directional bias
4. MOMENTUM — RSI14: reading below 35 = bullish lean, above 65 = bearish lean
5. VOLATILITY — ATR14 for stop sizing; spread should be < 20% of ATR before entering
6. ENTRY DECISION — if trend + momentum agree, ENTER. You do NOT need a saved plan to enter.
   A plan is a guide, not a gatekeeper. When the signal is clear, act on it.
`;
    return `${header}

${snapshotBlock}${extNote}${newsBlock}

${historyNote}
${signalPriority}
TASK: Evaluate and act. If trend and momentum align — place the trade. HOLD only when the signal is genuinely unclear or spread is too wide. Indecision is a mistake; missing a clear setup is worse than a stopped-out loss.${config.market !== 'mt5' ? ' Call get_order_book only if sizing a new entry.' : ''}

End with:
DECISION: [HOLD | BUY <qty> @ <price> | SELL <qty> @ <price> | CLOSE <ticket> | CANCEL <orderId>]
REASON: <1-2 sentences of evidence>`;
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
            const params = {
                symbol: input.symbol,
                side: input.side,
                type: input.type,
                quantity: input.quantity,
                price: input.price,
                timeInForce: input.timeInForce,
                stopPips: input.stopPips,
            };
            const agentGuardrails = getAgent(agentKey)?.config.guardrails;
            const validation = market === 'mt5'
                ? (() => { const ctx = getMt5Context(); return validateMt5Order(params, ctx.spread, ctx.sessionOpen, ctx.pipValue, agentGuardrails); })()
                : validateOrder(params, params.price ?? 0);
            if (!validation.ok) {
                log.warn({ reason: validation.reason }, 'order blocked by guardrails');
                return { blocked: true, reason: validation.reason };
            }
            if (market === 'mt5' && params.stopPips != null && params.price != null) {
                const ctxPoint = getMt5Context().point;
                const pipSz = pipSize(params.symbol, ctxPoint);
                params.stopPrice = params.side === 'BUY'
                    ? params.price - params.stopPips * pipSz
                    : params.price + params.stopPips * pipSz;
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
export async function runAgentTick(config, tickType = 'trading') {
    const agentKey = makeAgentKey(config.market, config.symbol, config.mt5AccountId, config.name);
    if (!tryAcquireCycleLock(agentKey)) {
        logEvent(agentKey, 'warn', 'tick_skip', 'Tick already running — skipped duplicate trigger');
        log.warn({ agentKey }, 'tick already in flight — skipping');
        return;
    }
    try {
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
        logEvent(agentKey, 'info', 'tick_start', `Tick #${tickNumber} starting for ${config.symbol} (${config.market})`);
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
                }
            }
            const summary = formatSnapshotSummary(snap);
            // Fetch recent forex news (non-blocking, fails silently)
            let newsItems;
            if (config.market === 'mt5') {
                newsItems = await fetchForexNews(config.symbol).catch(() => undefined);
            }
            tickUserMessage = buildTickMessage(config, tickNumber, isFirstTick, tickType, summary, externalCloseNote, newsItems);
        }
        catch (prefetchErr) {
            const msg = prefetchErr instanceof Error ? prefetchErr.message : String(prefetchErr);
            log.warn({ err: msg }, 'snapshot pre-fetch failed — LLM will call get_snapshot manually');
            tickUserMessage = buildTickMessage(config, tickNumber, isFirstTick, tickType);
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
                logEvent(agentKey, 'debug', 'claude_thinking', `Sending to ${providerLabel} (tick #${tickNumber}, iteration ${iterations})`);
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
                    if (text.trim()) {
                        logEvent(agentKey, 'info', 'claude_thinking', text.trim());
                    }
                    const decMatch = text.match(/DECISION:\s*(.+)/i);
                    const reasonMatch = text.match(/REASON:\s*(.+)/i);
                    // Strip markdown bold (**), collapse whitespace, cap at 300 chars so DB field stays clean
                    const cleanField = (s) => s.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
                    const decision = decMatch ? cleanField(decMatch[1]) : 'UNKNOWN';
                    const reason = reasonMatch ? cleanField(reasonMatch[1]) : '';
                    logEvent(agentKey, 'info', 'decision', `DECISION: ${decision}${reason ? ` — ${reason}` : ''}`);
                    log.info({ decision, tickNumber }, 'tick complete');
                    // Auto-execute safety net
                    if (!orderPlacedThisTick) {
                        const buyMatch = decision.match(/^BUY\s+([\d.]+)\s+@\s+([\d.]+)/i);
                        const sellMatch = decision.match(/^SELL\s+([\d.]+)\s+@\s+([\d.]+)/i);
                        const cancelMatch = decision.match(/^CANCEL\s+(\d+)/i);
                        if (buyMatch || sellMatch) {
                            const match = (buyMatch ?? sellMatch);
                            const side = buyMatch ? 'BUY' : 'SELL';
                            const qty = parseFloat(match[1]);
                            const price = parseFloat(match[2]);
                            logEvent(agentKey, 'warn', 'auto_execute', `Agent stated ${side} without calling place_order — auto-executing`);
                            try {
                                const result = await dispatchTool('place_order', {
                                    symbol: config.symbol, market: config.market,
                                    side, type: 'LIMIT', quantity: qty, price, stopPips: 20,
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