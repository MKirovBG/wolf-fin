// Wolf-Fin Risk State — backward-compat shim; state is now tracked per-market in riskStateStore.ts
import { getRiskStateFor, recordFillFor, updatePositionNotionalFor, MAX_POSITION_USD, } from './riskStateStore.js';
export { MAX_POSITION_USD };
/** Record a closed crypto trade P&L. Use recordFillFor(market, pnl) for per-market tracking. */
export function recordFill(pnlUsd) {
    recordFillFor('crypto', pnlUsd);
}
/** Update crypto position notional. Use updatePositionNotionalFor(market, n) for per-market tracking. */
export function updatePositionNotional(notionalUsd) {
    updatePositionNotionalFor('crypto', notionalUsd);
}
/** Returns risk state for the crypto market. */
export function getRiskState() {
    return getRiskStateFor('crypto');
}
//# sourceMappingURL=riskState.js.map