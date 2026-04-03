// Wolf-Fin — Anthropic SDK LLM provider
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();
export class AnthropicProvider {
    async createMessage(params) {
        const res = await client.messages.create({
            model: params.model,
            max_tokens: params.max_tokens,
            system: params.system,
            ...((params.tools?.length ?? 0) > 0 ? { tools: params.tools } : {}),
            messages: params.messages,
        });
        return {
            stop_reason: res.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
            content: res.content,
            usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
        };
    }
}
//# sourceMappingURL=anthropic.js.map