// Wolf-Fin Backtest — Deterministic strategy functions
// Each strategy receives a snapshot and returns a trade signal.
import { runMonteCarlo } from '../adapters/montecarlo.js';
// ── MC-Follow: follow the Monte Carlo recommendation ────────────────────────
export const mcFollow = (snap) => {
    const { indicators, candles, price, forex } = snap;
    const pipSz = forex?.pipSize ?? 1;
    const pipVal = forex?.pipValue ?? 1;
    const atr = indicators.atr14;
    if (!atr || atr <= 0 || candles.m1.length < 30) {
        return { action: 'HOLD', lots: 0, slPrice: 0, tpPrice: 0, reason: 'insufficient data' };
    }
    const mcInputs = {
        m1: candles.m1, m5: candles.m5, m15: candles.m15,
        m30: candles.m30, h1: candles.h1, h4: candles.h4,
        currentPrice: price.last, pipSize: pipSz, pipValue: pipVal,
        lotSize: 0.01, atr14: atr, ema20: indicators.ema20, ema50: indicators.ema50,
    };
    const mc = runMonteCarlo(mcInputs);
    if (!mc || mc.recommended === 'HOLD') {
        return { action: 'HOLD', lots: 0, slPrice: 0, tpPrice: 0, reason: mc ? 'MC: both EV negative' : 'MC: not enough candles' };
    }
    const slDist = atr * 1.0;
    const tpDist = atr * 1.5;
    const entry = price.last;
    if (mc.recommended === 'LONG') {
        return { action: 'BUY', lots: 0.01, slPrice: entry - slDist, tpPrice: entry + tpDist, reason: `MC LONG EV=${mc.long.ev.toFixed(0)} win=${mc.long.winRate.toFixed(1)}%` };
    }
    return { action: 'SELL', lots: 0.01, slPrice: entry + slDist, tpPrice: entry - tpDist, reason: `MC SHORT EV=${mc.short.ev.toFixed(0)} win=${mc.short.winRate.toFixed(1)}%` };
};
// ── EMA Cross: buy when EMA20 crosses above EMA50, sell when below ──────────
export const emaCross = (snap) => {
    const { indicators, price } = snap;
    const atr = indicators.atr14;
    if (!atr || atr <= 0) {
        return { action: 'HOLD', lots: 0, slPrice: 0, tpPrice: 0, reason: 'no ATR' };
    }
    const entry = price.last;
    const slDist = atr * 1.0;
    const tpDist = atr * 1.5;
    if (indicators.ema20 > indicators.ema50 && indicators.rsi14 > 50) {
        return { action: 'BUY', lots: 0.01, slPrice: entry - slDist, tpPrice: entry + tpDist, reason: `EMA20 > EMA50, RSI=${indicators.rsi14.toFixed(1)}` };
    }
    if (indicators.ema20 < indicators.ema50 && indicators.rsi14 < 50) {
        return { action: 'SELL', lots: 0.01, slPrice: entry + slDist, tpPrice: entry - tpDist, reason: `EMA20 < EMA50, RSI=${indicators.rsi14.toFixed(1)}` };
    }
    return { action: 'HOLD', lots: 0, slPrice: 0, tpPrice: 0, reason: 'no EMA cross alignment' };
};
export const STRATEGIES = {
    'mc-follow': mcFollow,
    'ema-cross': emaCross,
};
//# sourceMappingURL=strategies.js.map