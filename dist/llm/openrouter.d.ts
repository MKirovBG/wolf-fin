import type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js';
export declare class OpenRouterProvider implements LLMProvider {
    private readonly apiKey;
    constructor(apiKey: string);
    createMessage(params: LLMCreateParams): Promise<LLMResponse>;
}
//# sourceMappingURL=openrouter.d.ts.map