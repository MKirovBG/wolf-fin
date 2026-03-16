import type Anthropic from '@anthropic-ai/sdk';
export interface LLMResponse {
    stop_reason: 'end_turn' | 'tool_use';
    content: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock>;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}
export interface LLMCreateParams {
    model: string;
    max_tokens: number;
    system: string;
    tools: Anthropic.Tool[];
    messages: Anthropic.MessageParam[];
}
export interface LLMProvider {
    createMessage(params: LLMCreateParams): Promise<LLMResponse>;
}
//# sourceMappingURL=types.d.ts.map