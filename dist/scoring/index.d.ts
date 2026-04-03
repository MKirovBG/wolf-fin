import type { SetupCandidate } from '../types/setup.js';
import type { FeatureSnapshot, MarketState } from '../types/market.js';
import type { StrategyDefinition } from '../types/strategy.js';
export declare function scoreCandidate(candidate: SetupCandidate, features: FeatureSnapshot, marketState: MarketState, strategy?: StrategyDefinition): SetupCandidate;
/**
 * Score all candidates and sort by score descending.
 * Found candidates are scored fully; not-found candidates receive 0.
 */
export declare function scoreCandidates(candidates: SetupCandidate[], features: FeatureSnapshot, marketState: MarketState, strategy?: StrategyDefinition): SetupCandidate[];
//# sourceMappingURL=index.d.ts.map