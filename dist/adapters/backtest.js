// Wolf-Fin — MT5 Signal-Based Backtester
//
// Runs a bar-by-bar simulation over historical MT5 candle data.
// Entry signals are derived from technical indicators (RSI, EMA cross, ATR)
// which mirror the core heuristics the LLM agent typically applies.
//
// This is NOT an LLM replay — it is a deterministic rule engine designed to
// give a fast, reproducible approximation of how the strategy would have
// performed under the given indicator thresholds.
//
// P&L is computed in USD using the symbol's pip size and pip value so results
// are directly comparable to the live agent's reported P&L.
export const BACKTEST_DEFAULTS = {
    slMult: 1.0,
    tpMult: 1.5,
    maxHoldBars: 60,
    rsiOversold: 35,
    rsiOverbought: 65,
    requireEmaConfirm: true,
    rsiPeriod: 14,
    emaFast: 20,
    emaSlow: 50,
    atrPeriod: 14,
    startingEquityUsd: 10_000,
    maxRiskPercent: 2,
};
// ── Indicator helpers (in-place rolling — reuse across bars) ──────────────────
function computeRollingRSI(closes, period) {
    if (closes.length < period + 1)
        return 50;
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0)
            avgGain += diff;
        else
            avgLoss += -diff;
    }
    avgGain /= period;
    avgLoss /= period;
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
        avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    }
    if (avgLoss === 0)
        return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}
function computeRollingEMA(closes, period) {
    if (closes.length < period)
        return closes[closes.length - 1] ?? 0;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
}
function computeRollingATR(candles, period) {
    if (candles.length < period + 1)
        return candles[candles.length - 1]?.high - candles[candles.length - 1]?.low || 0;
    let atr = 0;
    // Seed
    for (let i = 1; i <= period; i++) {
        const tr = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
        atr += tr;
    }
    atr /= period;
    // Wilder smooth
    for (let i = period + 1; i < candles.length; i++) {
        const tr = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
        atr = (atr * (period - 1) + tr) / period;
    }
    return atr;
}
// ── Stats helpers ─────────────────────────────────────────────────────────────
function sharpeRatio(dailyPnls) {
    if (dailyPnls.length < 2)
        return null;
    const mean = dailyPnls.reduce((s, v) => s + v, 0) / dailyPnls.length;
    const variance = dailyPnls.reduce((s, v) => s + (v - mean) ** 2, 0) / (dailyPnls.length - 1);
    const std = Math.sqrt(variance);
    if (std === 0)
        return null;
    return parseFloat(((mean / std) * Math.sqrt(252)).toFixed(2));
}
// ── Main engine ───────────────────────────────────────────────────────────────
export function runBacktest(candles, cfg) {
    const RSI_PERIOD = cfg.rsiPeriod;
    const EMA_FAST = cfg.emaFast;
    const EMA_SLOW = cfg.emaSlow;
    const ATR_PERIOD = cfg.atrPeriod;
    const WARMUP = Math.max(RSI_PERIOD, EMA_SLOW, ATR_PERIOD) + 5;
    const trades = [];
    const equityCurve = [];
    let equity = cfg.startingEquityUsd;
    let cumPnl = 0;
    let peakEquity = equity;
    // Record equity at bar 0 (before any trades)
    equityCurve.push({ time: new Date(candles[0]?.openTime ?? 0).toISOString(), equity, cumPnl });
    let open = null;
    for (let i = WARMUP; i < candles.length; i++) {
        const bar = candles[i];
        const slice = candles.slice(0, i + 1);
        const closes = slice.map(c => c.close);
        const rsi = computeRollingRSI(closes, RSI_PERIOD);
        const ema20 = computeRollingEMA(closes, EMA_FAST);
        const ema50 = computeRollingEMA(closes, EMA_SLOW);
        const atr = computeRollingATR(slice, ATR_PERIOD);
        // ── Check exit of open position ──────────────────────────────────────────
        if (open !== null) {
            const barsHeld = i - open.barIndex;
            let closed = false;
            let exitPrice = bar.close;
            let exitReason = 'MAX_HOLD';
            if (open.direction === 'LONG') {
                if (bar.low <= open.sl) {
                    exitPrice = open.sl;
                    exitReason = 'SL';
                    closed = true;
                }
                else if (bar.high >= open.tp) {
                    exitPrice = open.tp;
                    exitReason = 'TP';
                    closed = true;
                }
            }
            else {
                if (bar.high >= open.sl) {
                    exitPrice = open.sl;
                    exitReason = 'SL';
                    closed = true;
                }
                else if (bar.low <= open.tp) {
                    exitPrice = open.tp;
                    exitReason = 'TP';
                    closed = true;
                }
            }
            if (!closed && barsHeld >= cfg.maxHoldBars) {
                exitReason = 'MAX_HOLD';
                closed = true;
            }
            if (closed) {
                const priceDiff = open.direction === 'LONG'
                    ? exitPrice - open.entry
                    : open.entry - exitPrice;
                const pips = priceDiff / cfg.pipSize;
                const pnlUsd = parseFloat((pips * cfg.pipValue * open.lots).toFixed(2));
                trades.push({
                    barIndex: open.barIndex,
                    openTime: new Date(candles[open.barIndex].openTime).toISOString(),
                    closeTime: new Date(bar.openTime).toISOString(),
                    direction: open.direction,
                    entry: open.entry,
                    exit: exitPrice,
                    sl: open.sl,
                    tp: open.tp,
                    exitReason,
                    pnlUsd,
                    lots: open.lots,
                    rsiAtEntry: open.rsiAtEntry,
                    atrAtEntry: open.atrAtEntry,
                    barsHeld,
                });
                equity += pnlUsd;
                cumPnl += pnlUsd;
                peakEquity = Math.max(peakEquity, equity);
                open = null;
                equityCurve.push({
                    time: new Date(bar.openTime).toISOString(),
                    equity: parseFloat(equity.toFixed(2)),
                    cumPnl: parseFloat(cumPnl.toFixed(2)),
                });
            }
        }
        // ── Entry signal (only when flat) ────────────────────────────────────────
        if (open === null && atr > 0) {
            const bullish = !cfg.requireEmaConfirm || ema20 > ema50;
            const bearish = !cfg.requireEmaConfirm || ema20 < ema50;
            const longSignal = rsi < cfg.rsiOversold && bullish;
            const shortSignal = rsi > cfg.rsiOverbought && bearish;
            let direction = null;
            if (longSignal)
                direction = 'LONG';
            else if (shortSignal)
                direction = 'SHORT';
            if (direction !== null) {
                const slDist = atr * cfg.slMult;
                const tpDist = atr * cfg.tpMult;
                const entry = bar.close;
                // Position sizing: risk maxRiskPercent of current equity
                const riskUsd = equity * (cfg.maxRiskPercent / 100);
                const slPips = slDist / cfg.pipSize;
                const riskPerLot = slPips * cfg.pipValue;
                const lots = riskPerLot > 0
                    ? Math.max(0.01, Math.floor((riskUsd / riskPerLot) * 100) / 100)
                    : 0.01;
                open = {
                    barIndex: i,
                    direction,
                    entry,
                    sl: direction === 'LONG' ? entry - slDist : entry + slDist,
                    tp: direction === 'LONG' ? entry + tpDist : entry - tpDist,
                    lots,
                    rsiAtEntry: parseFloat(rsi.toFixed(1)),
                    atrAtEntry: parseFloat(atr.toFixed(5)),
                };
            }
        }
    }
    // ── Statistics ────────────────────────────────────────────────────────────
    const wins = trades.filter(t => t.pnlUsd > 0);
    const losses = trades.filter(t => t.pnlUsd <= 0);
    const winRate = trades.length > 0 ? wins.length / trades.length : null;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlUsd, 0) / wins.length : null;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0) / losses.length) : null;
    const riskReward = avgWin != null && avgLoss != null && avgLoss > 0 ? avgWin / avgLoss : null;
    const grossWin = wins.reduce((s, t) => s + t.pnlUsd, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null;
    const expectancy = trades.length > 0 ? cumPnl / trades.length : 0;
    const avgBarsHeld = trades.length > 0
        ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length
        : 0;
    // Max drawdown
    let maxDD = 0;
    let peak = cfg.startingEquityUsd;
    let eq = cfg.startingEquityUsd;
    for (const t of trades) {
        eq += t.pnlUsd;
        peak = Math.max(peak, eq);
        maxDD = Math.max(maxDD, peak - eq);
    }
    const maxDrawdownPct = cfg.startingEquityUsd > 0 ? (maxDD / cfg.startingEquityUsd) * 100 : 0;
    // Max consecutive wins/losses
    let maxCW = 0, maxCL = 0, curCW = 0, curCL = 0;
    for (const t of trades) {
        if (t.pnlUsd > 0) {
            curCW++;
            curCL = 0;
            maxCW = Math.max(maxCW, curCW);
        }
        else {
            curCL++;
            curCW = 0;
            maxCL = Math.max(maxCL, curCL);
        }
    }
    // Annualised Sharpe on per-day P&L
    const byDay = {};
    for (const t of trades) {
        const day = t.closeTime.slice(0, 10);
        byDay[day] = (byDay[day] ?? 0) + t.pnlUsd;
    }
    const sharpe = sharpeRatio(Object.values(byDay));
    return {
        trades,
        equityCurve,
        stats: {
            totalTrades: trades.length,
            wins: wins.length,
            losses: losses.length,
            winRate,
            totalPnl: parseFloat(cumPnl.toFixed(2)),
            maxDrawdown: parseFloat(maxDD.toFixed(2)),
            maxDrawdownPct: parseFloat(maxDrawdownPct.toFixed(2)),
            sharpe,
            profitFactor: profitFactor != null ? parseFloat(profitFactor.toFixed(2)) : null,
            avgWin: avgWin != null ? parseFloat(avgWin.toFixed(2)) : null,
            avgLoss: avgLoss != null ? parseFloat(avgLoss.toFixed(2)) : null,
            riskReward: riskReward != null ? parseFloat(riskReward.toFixed(2)) : null,
            maxConsecWins: maxCW,
            maxConsecLosses: maxCL,
            avgBarsHeld: parseFloat(avgBarsHeld.toFixed(1)),
            expectancy: parseFloat(expectancy.toFixed(2)),
        },
        config: cfg,
        barsTotal: candles.length,
        warmupBars: WARMUP,
        ranAt: Date.now(),
    };
}
//# sourceMappingURL=backtest.js.map