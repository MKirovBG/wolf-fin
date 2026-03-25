import type { RiskState } from '../adapters/types.js';
declare const MAX_POSITION_USD: number;
declare const MAX_COMBINED_NOTIONAL_USD: number;
type Market = 'crypto' | 'mt5';
export interface Mt5Context {
    spread: number;
    sessionOpen: boolean;
    pipValue: number;
    point: number;
    digits: number;
    /** Broker-derived pip size — point>=0.01 means index/commodity/crypto (pip=1.0), else pip=point×10 */
    pipSize: number;
}
export declare function setMt5Context(ctx: Mt5Context): void;
export declare function getMt5Context(): Mt5Context;
/** Restore daily P&L from DB on server restart so the loss limit survives restarts. */
export declare function hydrateRiskStateFromDb(market: Market, pnlUsd: number): void;
export declare function recordFillFor(market: Market, pnlUsd: number): void;
export declare function updatePositionNotionalFor(market: Market, notionalUsd: number): void;
export declare function getRiskStateFor(market: Market): RiskState;
/** Sum of open position notional across all markets. */
export declare function getCombinedNotionalUsd(): number;
export { MAX_POSITION_USD, MAX_COMBINED_NOTIONAL_USD };
//# sourceMappingURL=riskStateStore.d.ts.map