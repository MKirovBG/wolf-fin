import type { RiskState } from '../adapters/types.js';
import { MAX_DAILY_LOSS_USD, MAX_POSITION_USD } from './riskStateStore.js';
export { MAX_DAILY_LOSS_USD, MAX_POSITION_USD };
/** Record a closed crypto trade P&L. Use recordFillFor(market, pnl) for per-market tracking. */
export declare function recordFill(pnlUsd: number): void;
/** Update crypto position notional. Use updatePositionNotionalFor(market, n) for per-market tracking. */
export declare function updatePositionNotional(notionalUsd: number): void;
/** Returns risk state for the crypto market. */
export declare function getRiskState(): RiskState;
/** True when the crypto daily loss limit is hit. */
export declare function isDailyLimitHit(): boolean;
//# sourceMappingURL=riskState.d.ts.map