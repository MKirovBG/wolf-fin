// Wolf-Fin — LLM provider factory

import type { AgentConfig } from '../types.js'
import type { LLMProvider } from './types.js'
import { AnthropicProvider } from './anthropic.js'
import { ClaudeSubscriptionProvider } from './claude-subscription.js'
import { OpenRouterProvider } from './openrouter.js'
import { OllamaProvider } from './ollama.js'
import { OpenAISubscriptionProvider } from './openai-subscription.js'

export function getLLMProvider(config: AgentConfig): LLMProvider {
  if (!config.llmProvider || config.llmProvider === 'platform') {
    return getPlatformLLMProvider()
  }
  if (config.llmProvider === 'anthropic-subscription') {
    const token = process.env.CLAUDE_SESSION_TOKEN
    if (!token) throw new Error('CLAUDE_SESSION_TOKEN not set — add it on the API Keys page')
    return new ClaudeSubscriptionProvider(token)
  }
  if (config.llmProvider === 'openrouter') {
    const key = process.env.OPENROUTER_API_KEY
    if (!key) throw new Error('OPENROUTER_API_KEY not set — add it on the API Keys page')
    return new OpenRouterProvider(key)
  }
  if (config.llmProvider === 'ollama') {
    const url = process.env.OLLAMA_URL || 'http://localhost:11434'
    return new OllamaProvider(url)
  }
  if (config.llmProvider === 'openai-subscription') {
    const status = getOpenAITokenStatus()
    if (status === 'expired') throw new Error('OpenAI token expired — click Refresh on the Integrations page')
    if (status === 'missing') throw new Error('OpenAI account not connected — authorize on the Integrations page')
    return new OpenAISubscriptionProvider(getOpenAIAccessToken()!)
  }
  return new AnthropicProvider()
}

export function getPlatformLLMProvider(): LLMProvider {
  const provider = process.env.PLATFORM_LLM_PROVIDER || 'anthropic'
  if (provider === 'anthropic-subscription') {
    const token = process.env.CLAUDE_SESSION_TOKEN
    if (!token) throw new Error('CLAUDE_SESSION_TOKEN not set — add it on the Integrations page')
    return new ClaudeSubscriptionProvider(token)
  }
  if (provider === 'openrouter') {
    const key = process.env.OPENROUTER_API_KEY
    if (!key) throw new Error('OPENROUTER_API_KEY not set — add it on the Integrations page')
    return new OpenRouterProvider(key)
  }
  if (provider === 'ollama') {
    const url = process.env.OLLAMA_URL || 'http://localhost:11434'
    return new OllamaProvider(url)
  }
  if (provider === 'openai-subscription') {
    const status = getOpenAITokenStatus()
    if (status === 'expired') throw new Error('OpenAI token expired — click Refresh on the Integrations page')
    if (status === 'missing') throw new Error('OpenAI account not connected — authorize on the Integrations page')
    return new OpenAISubscriptionProvider(getOpenAIAccessToken()!)
  }
  return new AnthropicProvider()
}

// ── OpenAI token helpers (checks expiry, returns current access token) ─────────

export function getOpenAIAccessToken(): string | null {
  const token   = process.env.OPENAI_ACCESS_TOKEN
  const expires = process.env.OPENAI_TOKEN_EXPIRES ? parseInt(process.env.OPENAI_TOKEN_EXPIRES) : 0
  if (!token) return null
  if (expires > 0 && Date.now() > expires) return null  // expired
  return token
}

export function getOpenAITokenStatus(): 'missing' | 'expired' | 'valid' {
  const token   = process.env.OPENAI_ACCESS_TOKEN
  const expires = process.env.OPENAI_TOKEN_EXPIRES ? parseInt(process.env.OPENAI_TOKEN_EXPIRES) : 0
  if (!token) return 'missing'
  if (expires > 0 && Date.now() > expires) return 'expired'
  return 'valid'
}

export function getPlatformLLMModel(): string {
  const provider = process.env.PLATFORM_LLM_PROVIDER || 'anthropic'
  const model = process.env.PLATFORM_LLM_MODEL?.trim()
  if (model) return model
  if (provider === 'openrouter') return 'anthropic/claude-sonnet-4-6'
  if (provider === 'ollama') return 'llama3.1'
  if (provider === 'openai-subscription') return 'gpt-4o'
  return process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'
}

export function getModelForConfig(config: AgentConfig): string {
  if (!config.llmProvider || config.llmProvider === 'platform') {
    return getPlatformLLMModel()
  }
  if (config.llmProvider === 'openrouter') {
    return config.llmModel ?? 'anthropic/claude-sonnet-4-6'
  }
  if (config.llmProvider === 'ollama') {
    return config.llmModel ?? 'llama3.1'
  }
  if (config.llmProvider === 'openai-subscription') {
    return config.llmModel ?? 'gpt-4o'
  }
  return process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'
}

export type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js'
