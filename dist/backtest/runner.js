// Wolf-Fin Backtest — Replay runner
// Reads recorded snapshots from JSONL and runs a deterministic strategy.
import { readFileSync } from 'fs';
export function runBacktest(recordingPath, strategy) {
    const raw = readFileSync(recordingPath, 'utf-8').trim();
    const snapshots = raw.split('\n').map(line => JSON.parse(line));
    const trades = [];
    let position = null;
    let equity = 0;
    let peakEquity = 0;
    let maxDrawdown = 0;
    for (let i = 0; i < snapshots.length; i++) {
        const snap = snapshots[i];
        const price = snap.price.last;
        // Check if open position hits SL or TP
        if (position) {
            const isLong = position.action === 'BUY';
            const hitSL = isLong ? price <= position.sl : price >= position.sl;
            const hitTP = isLong ? price >= position.tp : price <= position.tp;
            if (hitTP || hitSL) {
                const exitPrice = hitTP ? position.tp : position.sl;
                const pipSize = snap.forex?.pipSize ?? 1;
                const pipValue = snap.forex?.pipValue ?? 1;
                const pips = isLong
                    ? (exitPrice - position.entry) / pipSize
                    : (position.entry - exitPrice) / pipSize;
                const pnl = pips * pipValue * position.lots;
                trades.push({
                    tick: position.entryTick,
                    action: position.action,
                    entry: position.entry,
                    sl: position.sl,
                    tp: position.tp,
                    lots: position.lots,
                    reason: position.reason,
                    exitPrice,
                    exitTick: i,
                    pnl,
                    outcome: hitTP ? 'TP' : 'SL',
                });
                equity += pnl;
                peakEquity = Math.max(peakEquity, equity);
                maxDrawdown = Math.min(maxDrawdown, equity - peakEquity);
                position = null;
            }
        }
        // Only evaluate new entries when flat
        if (!position) {
            const signal = strategy(snap);
            if (signal.action !== 'HOLD') {
                position = {
                    action: signal.action,
                    entry: price,
                    sl: signal.slPrice,
                    tp: signal.tpPrice,
                    lots: signal.lots,
                    reason: signal.reason,
                    entryTick: i,
                };
            }
        }
    }
    // Close any remaining position at last price
    if (position && snapshots.length > 0) {
        const lastPrice = snapshots[snapshots.length - 1].price.last;
        const pipSize = snapshots[snapshots.length - 1].forex?.pipSize ?? 1;
        const pipValue = snapshots[snapshots.length - 1].forex?.pipValue ?? 1;
        const isLong = position.action === 'BUY';
        const pips = isLong
            ? (lastPrice - position.entry) / pipSize
            : (position.entry - lastPrice) / pipSize;
        const pnl = pips * pipValue * position.lots;
        trades.push({
            tick: position.entryTick,
            action: position.action,
            entry: position.entry,
            sl: position.sl,
            tp: position.tp,
            lots: position.lots,
            reason: position.reason,
            exitPrice: lastPrice,
            exitTick: snapshots.length - 1,
            pnl,
            outcome: 'OPEN',
        });
        equity += pnl;
    }
    const wins = trades.filter(t => t.pnl > 0).length;
    const losses = trades.filter(t => t.pnl <= 0).length;
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const avgPnl = trades.length > 0 ? totalPnl / trades.length : 0;
    // Sharpe ratio (simplified: mean return / stddev of returns)
    let sharpe = 0;
    if (trades.length > 1) {
        const pnls = trades.map(t => t.pnl);
        const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length;
        const variance = pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / pnls.length;
        const stdDev = Math.sqrt(variance);
        sharpe = stdDev > 0 ? mean / stdDev : 0;
    }
    return {
        totalTicks: snapshots.length,
        trades,
        wins,
        losses,
        winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
        totalPnl,
        avgPnl,
        sharpe,
        maxDrawdown,
    };
}
//# sourceMappingURL=runner.js.map