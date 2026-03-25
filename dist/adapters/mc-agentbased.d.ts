import type { Candle } from './types.js';
import type { AgentBasedResult } from './mc-types.js';
export interface AgentBasedInput {
    m15: Candle[];
    h1: Candle[];
    h4: Candle[];
    /** Optional: Fear & Greed value (0–100).  undefined = not available. */
    fearGreedValue?: number;
}
export declare function runAgentBased(input: AgentBasedInput): AgentBasedResult;
//# sourceMappingURL=mc-agentbased.d.ts.map