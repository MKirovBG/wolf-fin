// Wolf-Fin — LLM provider factory

import type { AgentConfig } from '../types.js'
import type { LLMProvider } from './types.js'
import { AnthropicProvider } from './anthropic.js'
import { OpenRouterProvider } from './openrouter.js'

export function getLLMProvider(config: AgentConfig): LLMProvider {
  if (config.llmProvider === 'openrouter') {
    const key = process.env.OPENROUTER_API_KEY
    if (!key) throw new Error('OPENROUTER_API_KEY not set — add it on the API Keys page')
    return new OpenRouterProvider(key)
  }
  return new AnthropicProvider()
}

export function getModelForConfig(config: AgentConfig): string {
  if (config.llmProvider === 'openrouter') {
    return config.llmModel ?? 'anthropic/claude-opus-4-5'
  }
  return process.env.CLAUDE_MODEL ?? 'claude-opus-4-5-20251101'
}

export type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js'
