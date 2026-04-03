import type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js';
export declare function refreshOpenAIToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
}>;
export declare class OpenAISubscriptionProvider implements LLMProvider {
    private readonly accessToken;
    private readonly accountId;
    constructor(accessToken: string);
    createMessage(params: LLMCreateParams): Promise<LLMResponse>;
}
//# sourceMappingURL=openai-subscription.d.ts.map