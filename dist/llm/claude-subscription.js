// Wolf-Fin — Anthropic subscription-based LLM provider (no API key required)
// Uses a Claude.ai OAuth token (CLAUDE_SESSION_TOKEN) via Bearer auth.
// Uses raw fetch to avoid the Anthropic SDK picking up ANTHROPIC_API_KEY from env.
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
export class ClaudeSubscriptionProvider {
    sessionToken;
    constructor(sessionToken) {
        this.sessionToken = sessionToken;
    }
    async createMessage(params) {
        const body = {
            model: params.model,
            max_tokens: params.max_tokens,
            system: params.system,
            messages: params.messages,
        };
        if (params.tools.length > 0)
            body.tools = params.tools;
        const res = await fetch(ANTHROPIC_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.sessionToken}`,
                'anthropic-version': ANTHROPIC_VERSION,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            throw new Error(`Anthropic subscription API ${res.status}: ${text}`);
        }
        const data = await res.json();
        return {
            stop_reason: data.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
            content: data.content,
            usage: { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens },
        };
    }
}
//# sourceMappingURL=claude-subscription.js.map