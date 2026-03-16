import type { Candle } from './types.js';
export declare function rsi(candles: Candle[], period?: number): number;
export declare function ema(candles: Candle[], period: number): number;
export declare function atr(candles: Candle[], period?: number): number;
export declare function vwap(candles: Candle[]): number;
export declare function bbWidth(candles: Candle[], period?: number, stdDevMultiplier?: number): number;
import type { Indicators } from './types.js';
export declare function computeIndicators(h1Candles: Candle[]): Indicators;
//# sourceMappingURL=indicators.d.ts.map