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
export declare function computePsar(candles: Candle[], step?: number, max?: number): {
    value: number;
    bullish: boolean;
} | undefined;
export declare function computeIchimoku(candles: Candle[], conversionPeriod?: number, basePeriod?: number, spanPeriod?: number, displacement?: number): {
    conversion: number;
    base: number;
    spanA: number;
    spanB: number;
    aboveCloud: boolean;
    cloudBullish: boolean;
} | undefined;
export declare function computeCci(candles: Candle[], period?: number): number | undefined;
export declare function computeWilliamsR(candles: Candle[], period?: number): number | undefined;
export declare function computeObv(candles: Candle[]): {
    value: number;
    rising: boolean;
} | undefined;
export declare function computeMfi(candles: Candle[], period?: number): number | undefined;
export declare function computeKeltner(candles: Candle[], period?: number, multiplier?: number): {
    upper: number;
    middle: number;
    lower: number;
} | undefined;
export declare function computeDivergence(candles: Candle[], period?: number): {
    rsi?: 'bullish' | 'bearish';
    macd?: 'bullish' | 'bearish';
} | undefined;
export declare function computeFibLevels(candles: Candle[]): Array<{
    price: number;
    label: string;
}>;
import type { Indicators, KeyLevel, MTFIndicators } from './types.js';
import type { IndicatorConfig } from '../types.js';
export declare function computeIndicators(h1Candles: Candle[], cfg?: IndicatorConfig): Indicators;
export declare function computeMultiTFIndicators(m15Candles: Candle[], h1Candles: Candle[], h4Candles: Candle[], cfg?: IndicatorConfig): MTFIndicators;
export declare function computeKeyLevels(h4Candles: Candle[], h1Candles: Candle[], currentPrice: number): KeyLevel[];
//# sourceMappingURL=indicators.d.ts.map