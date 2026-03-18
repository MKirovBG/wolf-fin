import type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js';
export declare class RateLimitError extends Error {
    readonly resetAt?: number | undefined;
    constructor(message: string, resetAt?: number | undefined);
}
export declare class OpenRouterProvider implements LLMProvider {
    private readonly apiKey;
    constructor(apiKey: string);
    createMessage(params: LLMCreateParams): Promise<LLMResponse>;
}
//# sourceMappingURL=openrouter.d.ts.map