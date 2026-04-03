// Wolf-Fin — Backtest performance metrics (Phase 4)
export function computeMetrics(trades, totalBars) {
    const resolved = trades.filter(t => t.outcome !== 'not_filled' && t.outcome !== 'expired');
    const won = resolved.filter(t => t.outcome === 'won_tp1' || t.outcome === 'won_tp2');
    const lost = resolved.filter(t => t.outcome === 'lost_sl');
    const expired = trades.filter(t => t.outcome === 'expired');
    const winRate = resolved.length > 0 ? (won.length / resolved.length) * 100 : 0;
    const avgWinR = won.length > 0 ? won.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / won.length : 0;
    const avgLossR = lost.length > 0 ? lost.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / lost.length : 0;
    const avgRR = resolved.length > 0
        ? resolved.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / resolved.length
        : 0;
    const lossRate = resolved.length > 0 ? lost.length / resolved.length : 0;
    const expectancy = (winRate / 100) * avgWinR + lossRate * avgLossR;
    const grossWins = won.reduce((s, t) => s + Math.max(0, t.rMultiple ?? 0), 0);
    const grossLosses = lost.reduce((s, t) => s + Math.abs(Math.min(0, t.rMultiple ?? 0)), 0);
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
    // Max consecutive losses
    let maxConsecLosses = 0;
    let curConsec = 0;
    for (const t of resolved) {
        if (t.outcome === 'lost_sl') {
            curConsec++;
            maxConsecLosses = Math.max(maxConsecLosses, curConsec);
        }
        else {
            curConsec = 0;
        }
    }
    // Group by setup type
    const bySetupType = {};
    for (const t of resolved) {
        const k = t.setupType;
        if (!bySetupType[k])
            bySetupType[k] = { trades: 0, wins: 0, winRate: 0 };
        bySetupType[k].trades++;
        if (t.outcome === 'won_tp1' || t.outcome === 'won_tp2')
            bySetupType[k].wins++;
    }
    for (const k of Object.keys(bySetupType)) {
        const g = bySetupType[k];
        g.winRate = g.trades > 0 ? (g.wins / g.trades) * 100 : 0;
    }
    // Group by session tag
    const bySession = {};
    for (const t of resolved) {
        const sess = t.tags.find(tag => ['London', 'NY', 'London-NY', 'Tokyo', 'off-session'].some(s => tag.includes(s))) ?? 'unknown';
        if (!bySession[sess])
            bySession[sess] = { trades: 0, wins: 0, winRate: 0 };
        bySession[sess].trades++;
        if (t.outcome === 'won_tp1' || t.outcome === 'won_tp2')
            bySession[sess].wins++;
    }
    for (const k of Object.keys(bySession)) {
        const g = bySession[k];
        g.winRate = g.trades > 0 ? (g.wins / g.trades) * 100 : 0;
    }
    return {
        totalBars,
        tradesTotal: trades.length,
        tradesWon: won.length,
        tradesLost: lost.length,
        tradesExpired: expired.length,
        winRate: +winRate.toFixed(1),
        avgRR: +avgRR.toFixed(2),
        avgWinR: +avgWinR.toFixed(2),
        avgLossR: +avgLossR.toFixed(2),
        expectancy: +expectancy.toFixed(3),
        maxConsecLosses,
        profitFactor: +profitFactor.toFixed(2),
        bySetupType,
        bySession,
    };
}
//# sourceMappingURL=metrics.js.map