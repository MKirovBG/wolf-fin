import type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js';
export declare class ClaudeSubscriptionProvider implements LLMProvider {
    private readonly sessionToken;
    constructor(sessionToken: string);
    createMessage(params: LLMCreateParams): Promise<LLMResponse>;
}
//# sourceMappingURL=claude-subscription.d.ts.map