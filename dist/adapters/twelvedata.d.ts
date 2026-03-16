import type { Candle } from './types.js';
export type Interval = '1min' | '15min' | '1h' | '4h';
/**
 * Fetches OHLCV candles for a forex pair from Twelve Data.
 * Returns [] when TWELVE_DATA_KEY is missing or on any error.
 */
export declare function fetchCandlesTwelveData(symbol: string, interval: Interval, outputsize?: number): Promise<Candle[]>;
/** Backward-compatible alias */
export declare const fetchCandlesFallback: typeof fetchCandlesTwelveData;
/**
 * Fetches the latest quote for a forex pair from Twelve Data.
 * Returns last price; bid/ask are approximated with a conservative 1-pip spread
 * (actual execution spread comes from Alpaca at order time).
 */
export declare function fetchQuoteTwelveData(symbol: string): Promise<{
    bid: number;
    ask: number;
    last: number;
} | null>;
//# sourceMappingURL=twelvedata.d.ts.map