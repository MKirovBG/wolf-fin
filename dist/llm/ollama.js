// Wolf-Fin — Ollama LLM provider (local models via OpenAI-compatible API)
import { toOAITools, toOAIMessages, fromOAIResponse } from './oai-compat.js';
export class OllamaProvider {
    baseUrl;
    constructor(baseUrl = 'http://localhost:11434') {
        this.baseUrl = baseUrl;
    }
    async createMessage(params) {
        const hasTools = params.tools.length > 0;
        const body = {
            model: params.model,
            max_tokens: params.max_tokens,
            messages: toOAIMessages(params.system, params.messages),
            ...(hasTools ? { tools: toOAITools(params.tools), tool_choice: 'auto' } : {}),
            stream: false,
        };
        let res;
        try {
            res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        }
        catch (e) {
            throw new Error(`Ollama is not reachable at ${this.baseUrl} — start it with 'ollama serve'`);
        }
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Ollama API error ${res.status}: ${err}`);
        }
        const data = await res.json();
        return fromOAIResponse(data);
    }
}
//# sourceMappingURL=ollama.js.map