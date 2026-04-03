import type { WatchSymbol } from '../types.js';
import type { LLMProvider } from './types.js';
export declare function getLLMProvider(config: WatchSymbol): LLMProvider;
export declare function getPlatformLLMProvider(): LLMProvider;
export declare function getOpenAIAccessToken(): string | null;
export declare function getOpenAITokenStatus(): 'missing' | 'expired' | 'valid';
export declare function getPlatformLLMModel(): string;
export declare function getModelForConfig(config: WatchSymbol): string;
export type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js';
//# sourceMappingURL=index.d.ts.map