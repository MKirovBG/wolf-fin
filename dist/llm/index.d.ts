import type { AgentConfig } from '../types.js';
import type { LLMProvider } from './types.js';
export declare function getLLMProvider(config: AgentConfig): LLMProvider;
export declare function getModelForConfig(config: AgentConfig): string;
export declare function getPlatformLLMProvider(): LLMProvider;
export declare function getPlatformLLMModel(): string;
export type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js';
//# sourceMappingURL=index.d.ts.map