import type { FeatureSnapshot } from '../types/market.js';
interface SimilarAnalysis {
    analysisId: number;
    symbolKey: string;
    capturedAt: string;
    distance: number;
    features: FeatureSnapshot;
}
/**
 * Compute a Euclidean-style distance between two feature snapshots.
 * Only uses the most stable numeric dimensions.
 */
export declare function featureDistance(a: FeatureSnapshot, b: FeatureSnapshot): number;
/**
 * Find the N most similar past feature snapshots from a list.
 */
export declare function findSimilarAnalyses(current: FeatureSnapshot, history: Array<{
    analysisId: number;
    symbolKey: string;
    capturedAt: string;
    features: FeatureSnapshot;
}>, topN?: number): SimilarAnalysis[];
declare module '../types/market.js' {
    interface FeatureSnapshot {
        marketStateProxy?: {
            regime: string;
        };
    }
}
export {};
//# sourceMappingURL=similarity.d.ts.map