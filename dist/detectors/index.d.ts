import type { DetectorInput, DetectorFn } from './interface.js';
import type { SetupCandidate } from '../types/setup.js';
export declare const DETECTORS: Record<string, DetectorFn>;
export declare const ALL_DETECTOR_KEYS: string[];
/**
 * Run all detectors (or a subset) against the current market state.
 * Returns all candidates — both found and not found — so the UI can show
 * why setups were rejected.
 */
export declare function runDetectors(input: DetectorInput, allowedDetectors?: string[]): SetupCandidate[];
//# sourceMappingURL=index.d.ts.map