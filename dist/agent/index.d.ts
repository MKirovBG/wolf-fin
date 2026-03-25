import type { AgentConfig } from '../types.js';
export type { AgentConfig } from '../types.js';
export declare function buildSystemPrompt(config: AgentConfig, agentKey: string, sessionSummary?: string | null): string;
export declare function runAgentTick(config: AgentConfig, requestedTickType?: 'trading' | 'planning', ephemeralInstructions?: string): Promise<void>;
export declare const runAgentCycle: typeof runAgentTick;
//# sourceMappingURL=index.d.ts.map