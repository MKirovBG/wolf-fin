import type { Candle } from './types.js';
export declare function rsi(candles: Candle[], period?: number): number;
export declare function ema(candles: Candle[], period: number): number;
export declare function atr(candles: Candle[], period?: number): number;
export declare function vwap(candles: Candle[]): number;
export declare function bbWidth(candles: Candle[], period?: number, stdDevMultiplier?: number): number;
export declare function computeMacd(candles: Candle[], fast?: number, slow?: number, signal?: number): {
    macd: number;
    signal: number;
    histogram: number;
} | undefined;
export declare function computeAdx(candles: Candle[], period?: number): {
    adx: number;
    plusDI: number;
    minusDI: number;
} | undefined;
export declare function computeStoch(candles: Candle[], period?: number, signalPeriod?: number): {
    k: number;
    d: number;
} | undefined;
import type { Indicators, KeyLevel, MTFIndicators } from './types.js';
import type { IndicatorConfig } from '../types.js';
export declare function computeIndicators(h1Candles: Candle[], cfg?: IndicatorConfig): Indicators;
export declare function computeMultiTFIndicators(m15Candles: Candle[], h1Candles: Candle[], h4Candles: Candle[], cfg?: IndicatorConfig): MTFIndicators;
export declare function computeKeyLevels(h4Candles: Candle[], h1Candles: Candle[], currentPrice: number): KeyLevel[];
//# sourceMappingURL=indicators.d.ts.map