export interface FearGreedResult {
    value: number;
    classification: string;
}
/**
 * Fetches the latest Fear & Greed index from Alternative.me.
 * Returns null on any network/parse error so the caller can degrade gracefully.
 */
export declare function fetchFearGreed(): Promise<FearGreedResult | null>;
//# sourceMappingURL=feargreed.d.ts.map