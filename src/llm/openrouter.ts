// Wolf-Fin — OpenRouter LLM provider (OpenAI-compatible API)

import type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js'
import { toOAITools, toOAIMessages, fromOAIResponse } from './oai-compat.js'
import type { OAIResponse } from './oai-compat.js'

// ── Typed errors ──────────────────────────────────────────────────────────────

export class RateLimitError extends Error {
  constructor(message: string, public readonly resetAt?: number) {
    super(message)
    this.name = 'RateLimitError'
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class OpenRouterProvider implements LLMProvider {
  constructor(private readonly apiKey: string) {}

  async createMessage(params: LLMCreateParams): Promise<LLMResponse> {
    const hasTools = (params.tools?.length ?? 0) > 0
    const body = {
      model: params.model,
      max_tokens: params.max_tokens,
      messages: toOAIMessages(params.system, params.messages),
      ...(hasTools ? { tools: toOAITools(params.tools), tool_choice: 'auto' } : {}),
    }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wolf-fin.local',
        'X-Title': 'Wolf-Fin Trading Agent',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.text()
      if (res.status === 429) {
        const resetHeader = res.headers.get('X-RateLimit-Reset')
        const resetAt = resetHeader ? parseInt(resetHeader, 10) : undefined
        throw new RateLimitError(`OpenRouter API error 429: ${err}`, resetAt)
      }
      throw new Error(`OpenRouter API error ${res.status}: ${err}`)
    }

    const data = await res.json() as OAIResponse
    return fromOAIResponse(data)
  }
}
