// Wolf-Fin — LLM provider factory
import { AnthropicProvider } from './anthropic.js';
import { OpenRouterProvider } from './openrouter.js';
import { OllamaProvider } from './ollama.js';
export function getLLMProvider(config) {
    if (config.llmProvider === 'openrouter') {
        const key = process.env.OPENROUTER_API_KEY;
        if (!key)
            throw new Error('OPENROUTER_API_KEY not set — add it on the API Keys page');
        return new OpenRouterProvider(key);
    }
    if (config.llmProvider === 'ollama') {
        const url = process.env.OLLAMA_URL || 'http://localhost:11434';
        return new OllamaProvider(url);
    }
    return new AnthropicProvider();
}
export function getModelForConfig(config) {
    if (config.llmProvider === 'openrouter') {
        return config.llmModel ?? 'anthropic/claude-opus-4-5';
    }
    if (config.llmProvider === 'ollama') {
        return config.llmModel ?? 'llama3.1';
    }
    return process.env.CLAUDE_MODEL ?? 'claude-opus-4-5-20251101';
}
//# sourceMappingURL=index.js.map