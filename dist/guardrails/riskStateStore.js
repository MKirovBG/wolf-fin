// Wolf-Fin Risk State Store — per-market daily P&L tracker
const MAX_DAILY_LOSS_USD = parseFloat(process.env.MAX_DAILY_LOSS_USD ?? '200');
const MAX_POSITION_USD = parseFloat(process.env.MAX_POSITION_USD ?? '1000');
const MAX_COMBINED_NOTIONAL_USD = parseFloat(process.env.MAX_COMBINED_NOTIONAL_USD ?? '2000');
let lastForexContext = { spread: 0, sessionOpen: false, pipValue: 0.0001 };
export function setForexContext(ctx) {
    lastForexContext = ctx;
}
export function getForexContext() {
    return lastForexContext;
}
// ── Per-market day state ───────────────────────────────────────────────────────
function utcDateString() {
    return new Date().toISOString().slice(0, 10);
}
function freshState() {
    return { date: utcDateString(), realizedPnlUsd: 0, peakPnlUsd: 0, positionNotionalUsd: 0 };
}
const states = {
    crypto: freshState(),
    forex: freshState(),
};
function get(market) {
    if (states[market].date !== utcDateString())
        states[market] = freshState();
    return states[market];
}
/** Restore daily P&L from DB on server restart so the loss limit survives restarts. */
export function hydrateRiskStateFromDb(market, pnlUsd) {
    const s = get(market);
    s.realizedPnlUsd = pnlUsd;
    if (pnlUsd > s.peakPnlUsd)
        s.peakPnlUsd = pnlUsd;
}
export function recordFillFor(market, pnlUsd) {
    const s = get(market);
    s.realizedPnlUsd += pnlUsd;
    if (s.realizedPnlUsd > s.peakPnlUsd)
        s.peakPnlUsd = s.realizedPnlUsd;
}
export function updatePositionNotionalFor(market, notionalUsd) {
    get(market).positionNotionalUsd = notionalUsd;
}
export function getRiskStateFor(market) {
    const s = get(market);
    const dailyLoss = Math.min(0, s.realizedPnlUsd);
    return {
        dailyPnlUsd: s.realizedPnlUsd,
        remainingBudgetUsd: Math.max(0, MAX_DAILY_LOSS_USD + dailyLoss),
        positionNotionalUsd: s.positionNotionalUsd,
    };
}
export function isDailyLimitHitFor(market) {
    return get(market).realizedPnlUsd <= -MAX_DAILY_LOSS_USD;
}
/** Sum of open position notional across all markets. */
export function getCombinedNotionalUsd() {
    return get('crypto').positionNotionalUsd + get('forex').positionNotionalUsd;
}
export { MAX_DAILY_LOSS_USD, MAX_POSITION_USD, MAX_COMBINED_NOTIONAL_USD };
//# sourceMappingURL=riskStateStore.js.map