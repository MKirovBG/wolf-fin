import type Anthropic from '@anthropic-ai/sdk';
import type { LLMResponse } from './types.js';
export interface OAITool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    };
}
export interface OAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | null;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
    tool_call_id?: string;
}
export interface OAIResponse {
    choices: Array<{
        finish_reason: string;
        message: {
            role: 'assistant';
            content: string | null;
            tool_calls?: Array<{
                id: string;
                type: 'function';
                function: {
                    name: string;
                    arguments: string;
                };
            }>;
        };
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
    };
}
export declare function toOAITools(tools: Anthropic.Tool[] | undefined): OAITool[];
export declare function toOAIMessages(system: string, messages: Anthropic.MessageParam[]): OAIMessage[];
export declare function fromOAIResponse(res: OAIResponse): LLMResponse;
//# sourceMappingURL=oai-compat.d.ts.map