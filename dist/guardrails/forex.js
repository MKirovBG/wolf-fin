// Wolf-Fin Forex Guardrails — validateForexOrder
import { getRiskStateFor, isDailyLimitHitFor, getCombinedNotionalUsd, MAX_COMBINED_NOTIONAL_USD, } from './riskStateStore.js';
const MAX_SPREAD_PIPS = parseFloat(process.env.MAX_SPREAD_PIPS ?? '3');
const MIN_STOP_PIPS = parseFloat(process.env.MIN_STOP_PIPS ?? '10');
/**
 * Validate a forex order before sending to Alpaca.
 *
 * @param params    - Order parameters (symbol, side, qty, price, stopPips)
 * @param spread    - Current bid/ask spread in pips (from last snapshot)
 * @param sessionOpen - Whether a major forex session is currently active
 * @param pipValue  - USD value per pip per unit (from Alpaca adapter)
 */
export function validateForexOrder(params, spread, sessionOpen, pipValue) {
    // 1. Daily loss gate
    if (isDailyLimitHitFor('forex')) {
        return { ok: false, reason: 'Forex daily loss limit reached — trading halted for today' };
    }
    // 2. Session must be open
    if (!sessionOpen) {
        return { ok: false, reason: 'Forex market session is closed — order rejected' };
    }
    // 3. Spread check
    if (spread > MAX_SPREAD_PIPS) {
        return {
            ok: false,
            reason: `Spread ${spread.toFixed(1)} pips exceeds maximum ${MAX_SPREAD_PIPS} pips`,
        };
    }
    // 4. stopPips required and must meet minimum
    if (params.stopPips == null) {
        return { ok: false, reason: 'Forex orders require stopPips (use ATR-based distance)' };
    }
    if (params.stopPips < MIN_STOP_PIPS) {
        return {
            ok: false,
            reason: `stopPips ${params.stopPips} below minimum ${MIN_STOP_PIPS} — stop too tight`,
        };
    }
    // 5. Pip-based risk: units × pipValue × stopPips <= remainingBudget
    const pipRiskUsd = params.quantity * pipValue * params.stopPips;
    const risk = getRiskStateFor('forex');
    if (pipRiskUsd > risk.remainingBudgetUsd) {
        return {
            ok: false,
            reason: `Pip risk $${pipRiskUsd.toFixed(2)} exceeds remaining forex budget $${risk.remainingBudgetUsd.toFixed(2)}`,
        };
    }
    // 6. Combined notional cap across all markets (buys only)
    if (params.side === 'BUY') {
        const orderNotional = params.quantity * (params.price ?? 1);
        const projected = getCombinedNotionalUsd() + orderNotional;
        if (projected > MAX_COMBINED_NOTIONAL_USD) {
            return {
                ok: false,
                reason: `Combined notional $${projected.toFixed(2)} would exceed cap $${MAX_COMBINED_NOTIONAL_USD}`,
            };
        }
    }
    return { ok: true };
}
//# sourceMappingURL=forex.js.map