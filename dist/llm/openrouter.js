// Wolf-Fin — OpenRouter LLM provider (OpenAI-compatible API)
// Translates between Anthropic message format (internal canonical) and OpenAI format.
// ── Typed errors ──────────────────────────────────────────────────────────────
export class RateLimitError extends Error {
    resetAt;
    constructor(message, resetAt) {
        super(message);
        this.resetAt = resetAt;
        this.name = 'RateLimitError';
    }
}
// ── Translators ───────────────────────────────────────────────────────────────
function toOAITools(tools) {
    return tools.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
        },
    }));
}
function toOAIMessages(system, messages) {
    const result = [{ role: 'system', content: system }];
    for (const msg of messages) {
        if (msg.role === 'user') {
            if (typeof msg.content === 'string') {
                result.push({ role: 'user', content: msg.content });
            }
            else {
                const blocks = msg.content;
                const textBlocks = blocks.filter(b => b.type === 'text');
                const toolResults = blocks.filter(b => b.type === 'tool_result');
                if (textBlocks.length > 0) {
                    result.push({ role: 'user', content: textBlocks.map(b => b.text).join('\n') });
                }
                for (const tr of toolResults) {
                    result.push({
                        role: 'tool',
                        tool_call_id: tr.tool_use_id,
                        content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
                    });
                }
            }
        }
        else if (msg.role === 'assistant') {
            if (typeof msg.content === 'string') {
                result.push({ role: 'assistant', content: msg.content });
            }
            else {
                const blocks = msg.content;
                const textBlocks = blocks.filter(b => b.type === 'text');
                const toolUseBlocks = blocks.filter(b => b.type === 'tool_use');
                const assistantMsg = {
                    role: 'assistant',
                    content: textBlocks.map(b => b.text).join('\n') || null,
                };
                if (toolUseBlocks.length > 0) {
                    assistantMsg.tool_calls = toolUseBlocks.map(b => ({
                        id: b.id,
                        type: 'function',
                        function: { name: b.name, arguments: JSON.stringify(b.input) },
                    }));
                }
                result.push(assistantMsg);
            }
        }
    }
    return result;
}
function fromOAIResponse(res) {
    const choice = res.choices[0];
    const msg = choice.message;
    const content = [];
    if (msg.content) {
        content.push({ type: 'text', text: msg.content });
    }
    for (const tc of msg.tool_calls ?? []) {
        let input;
        try {
            input = JSON.parse(tc.function.arguments);
        }
        catch {
            input = {};
        }
        content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
    return {
        stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
        content,
        usage: { input_tokens: res.usage.prompt_tokens, output_tokens: res.usage.completion_tokens },
    };
}
// ── Provider ──────────────────────────────────────────────────────────────────
export class OpenRouterProvider {
    apiKey;
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async createMessage(params) {
        const body = {
            model: params.model,
            max_tokens: params.max_tokens,
            messages: toOAIMessages(params.system, params.messages),
            tools: toOAITools(params.tools),
            tool_choice: 'auto',
        };
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://wolf-fin.local',
                'X-Title': 'Wolf-Fin Trading Agent',
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.text();
            if (res.status === 429) {
                const resetHeader = res.headers.get('X-RateLimit-Reset');
                const resetAt = resetHeader ? parseInt(resetHeader, 10) : undefined;
                throw new RateLimitError(`OpenRouter API error 429: ${err}`, resetAt);
            }
            throw new Error(`OpenRouter API error ${res.status}: ${err}`);
        }
        const data = await res.json();
        return fromOAIResponse(data);
    }
}
//# sourceMappingURL=openrouter.js.map