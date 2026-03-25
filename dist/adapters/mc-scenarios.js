// Wolf-Fin — Monte Carlo Layer 3: Scenario / Stress Analysis
//
// Runs the core MC simulation under multiple volatility regimes and returns a
// result for each scenario so the agent can see how the strategy holds up in
// adverse conditions — not just the current volatility environment.
//
// Scenarios modelled:
//   Normal          — uses raw historical returns as-is
//   High Volatility — ATR × 2.0 (news event, spike)
//   Low Volatility  — ATR × 0.5 (dead session, consolidation)
//   Pre-News        — ATR × 1.5 + widened spread
//   Session Boundary— ATR × 1.3 (open/close liquidity drain)
// ── Helpers ───────────────────────────────────────────────────────────────────
function mean(arr) {
    return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}
function std(arr) {
    if (arr.length < 2)
        return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}
/** Draw a random sample from arr (bootstrap) */
function sample(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
/** Classify current ATR vs recent median ATR to determine current regime */
function classifyRegime(currentAtr, medianAtr) {
    const ratio = currentAtr / (medianAtr || currentAtr);
    if (ratio > 2.0)
        return 'EXTREME_VOL';
    if (ratio > 1.3)
        return 'HIGH_VOL';
    if (ratio < 0.6)
        return 'LOW_VOL';
    return 'NORMAL';
}
// ── MC runner for a single scenario ──────────────────────────────────────────
function runScenario(p, label, regime) {
    const scaledMean = mean(p.returns) * p.atrMultiplier;
    const scaledStd = std(p.returns) * p.atrMultiplier;
    let longWins = 0, longEv = 0;
    let shortWins = 0, shortEv = 0;
    for (let sim = 0; sim < p.simCount; sim++) {
        // LONG simulation
        let longPrice = p.entryPrice;
        let longResult = 0;
        for (let bar = 0; bar < p.barsForward; bar++) {
            const ret = scaledMean + scaledStd * (Math.random() * 2 - 1); // simplified normal approx
            longPrice *= (1 + ret);
            if (longPrice <= p.entryPrice - p.slPips) {
                longResult = -p.slPips;
                break;
            }
            if (longPrice >= p.entryPrice + p.tpPips) {
                longResult = p.tpPips;
                break;
            }
        }
        if (longResult > 0)
            longWins++;
        longEv += longResult;
        // SHORT simulation
        let shortPrice = p.entryPrice;
        let shortResult = 0;
        for (let bar = 0; bar < p.barsForward; bar++) {
            const ret = scaledMean + scaledStd * (Math.random() * 2 - 1);
            shortPrice *= (1 + ret);
            if (shortPrice >= p.entryPrice + p.slPips) {
                shortResult = -p.slPips;
                break;
            }
            if (shortPrice <= p.entryPrice - p.tpPips) {
                shortResult = p.tpPips;
                break;
            }
        }
        if (shortResult > 0)
            shortWins++;
        shortEv += shortResult;
    }
    const longWinRate = longWins / p.simCount;
    const shortWinRate = shortWins / p.simCount;
    const lEv = longEv / p.simCount;
    const sEv = shortEv / p.simCount;
    const recommended = (() => {
        if (lEv <= 0 && sEv <= 0)
            return 'HOLD';
        if (lEv > sEv)
            return 'LONG';
        return 'SHORT';
    })();
    return {
        label,
        regime,
        atrMultiplier: p.atrMultiplier,
        longWinRate: parseFloat(longWinRate.toFixed(4)),
        shortWinRate: parseFloat(shortWinRate.toFixed(4)),
        longEv: parseFloat(lEv.toFixed(6)),
        shortEv: parseFloat(sEv.toFixed(6)),
        recommended,
    };
}
export function runScenarios(input) {
    const { m1, entryPrice, slPips, tpPips, simCount = 500, barsForward = 30, } = input;
    if (m1.length < 30) {
        // Insufficient data — return empty stub
        const stub = {
            label: 'Normal', regime: 'NORMAL', atrMultiplier: 1,
            longWinRate: 0.5, shortWinRate: 0.5, longEv: 0, shortEv: 0, recommended: 'HOLD',
        };
        return {
            currentRegime: 'NORMAL',
            scenarios: [stub],
            avoidTrading: false,
            avoidReason: null,
            worstCase: stub,
        };
    }
    // Compute log returns
    const returns = [];
    for (let i = 1; i < m1.length; i++) {
        returns.push((m1[i].close - m1[i - 1].close) / m1[i - 1].close);
    }
    // ATR (14-period simple mean of TR)
    const trs = [];
    for (let i = 1; i < m1.length; i++) {
        trs.push(Math.max(m1[i].high - m1[i].low, Math.abs(m1[i].high - m1[i - 1].close), Math.abs(m1[i].low - m1[i - 1].close)));
    }
    const currentAtr = trs.slice(-14).reduce((s, v) => s + v, 0) / Math.min(14, trs.length);
    const medianAtr = [...trs].sort((a, b) => a - b)[Math.floor(trs.length / 2)] || currentAtr;
    const currentRegime = classifyRegime(currentAtr, medianAtr);
    const specs = [
        { label: 'Normal', regime: 'NORMAL', atrMultiplier: 1.0 },
        { label: 'High Volatility', regime: 'HIGH_VOL', atrMultiplier: 2.0 },
        { label: 'Low Volatility', regime: 'LOW_VOL', atrMultiplier: 0.5 },
        { label: 'Pre-News', regime: 'HIGH_VOL', atrMultiplier: 1.5 },
        { label: 'Session Boundary', regime: 'NORMAL', atrMultiplier: 1.3 },
    ];
    const baseParams = {
        returns,
        atr: currentAtr,
        entryPrice,
        slPips,
        tpPips,
        simCount,
        barsForward,
    };
    const scenarios = specs.map(s => runScenario({ ...baseParams, atrMultiplier: s.atrMultiplier }, s.label, s.regime));
    // Worst case = lowest EV across both directions
    const worstCase = scenarios.reduce((worst, s) => {
        const sMin = Math.min(s.longEv, s.shortEv);
        const wMin = Math.min(worst.longEv, worst.shortEv);
        return sMin < wMin ? s : worst;
    }, scenarios[0]);
    const avoidTrading = scenarios.every(s => s.recommended === 'HOLD' || (s.longEv <= 0 && s.shortEv <= 0));
    const avoidReason = avoidTrading
        ? `All ${scenarios.length} scenarios show negative or zero expected value — conditions unfavourable.`
        : null;
    return {
        currentRegime,
        scenarios,
        avoidTrading,
        avoidReason,
        worstCase,
    };
}
//# sourceMappingURL=mc-scenarios.js.map