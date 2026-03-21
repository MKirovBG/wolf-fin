import type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js';
export declare class OllamaProvider implements LLMProvider {
    private readonly baseUrl;
    constructor(baseUrl?: string);
    createMessage(params: LLMCreateParams): Promise<LLMResponse>;
}
//# sourceMappingURL=ollama.d.ts.map