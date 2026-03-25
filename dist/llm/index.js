// Wolf-Fin — LLM provider factory
import { AnthropicProvider } from './anthropic.js';
import { ClaudeSubscriptionProvider } from './claude-subscription.js';
import { OpenRouterProvider } from './openrouter.js';
import { OllamaProvider } from './ollama.js';
export function getLLMProvider(config) {
    if (!config.llmProvider || config.llmProvider === 'platform') {
        return getPlatformLLMProvider();
    }
    if (config.llmProvider === 'anthropic-subscription') {
        const token = process.env.CLAUDE_SESSION_TOKEN;
        if (!token)
            throw new Error('CLAUDE_SESSION_TOKEN not set — add it on the API Keys page');
        return new ClaudeSubscriptionProvider(token);
    }
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
    if (!config.llmProvider || config.llmProvider === 'platform') {
        return getPlatformLLMModel();
    }
    if (config.llmProvider === 'openrouter') {
        return config.llmModel ?? 'anthropic/claude-sonnet-4-6';
    }
    if (config.llmProvider === 'ollama') {
        return config.llmModel ?? 'llama3.1';
    }
    return process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';
}
export function getPlatformLLMProvider() {
    const provider = process.env.PLATFORM_LLM_PROVIDER || 'anthropic';
    if (provider === 'anthropic-subscription') {
        const token = process.env.CLAUDE_SESSION_TOKEN;
        if (!token)
            throw new Error('CLAUDE_SESSION_TOKEN not set — add it on the Integrations page');
        return new ClaudeSubscriptionProvider(token);
    }
    if (provider === 'openrouter') {
        const key = process.env.OPENROUTER_API_KEY;
        if (!key)
            throw new Error('OPENROUTER_API_KEY not set — add it on the Integrations page');
        return new OpenRouterProvider(key);
    }
    if (provider === 'ollama') {
        const url = process.env.OLLAMA_URL || 'http://localhost:11434';
        return new OllamaProvider(url);
    }
    return new AnthropicProvider();
}
export function getPlatformLLMModel() {
    const provider = process.env.PLATFORM_LLM_PROVIDER || 'anthropic';
    const model = process.env.PLATFORM_LLM_MODEL?.trim();
    if (model)
        return model;
    if (provider === 'openrouter')
        return 'anthropic/claude-sonnet-4-6';
    if (provider === 'ollama')
        return 'llama3.1';
    return process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';
}
//# sourceMappingURL=index.js.map