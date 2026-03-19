// Wolf-Fin — Ollama LLM provider (local models via OpenAI-compatible API)

import type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js'
import { toOAITools, toOAIMessages, fromOAIResponse } from './oai-compat.js'
import type { OAIResponse } from './oai-compat.js'

export class OllamaProvider implements LLMProvider {
  constructor(private readonly baseUrl: string = 'http://localhost:11434') {}

  async createMessage(params: LLMCreateParams): Promise<LLMResponse> {
    const body = {
      model: params.model,
      max_tokens: params.max_tokens,
      messages: toOAIMessages(params.system, params.messages),
      tools: toOAITools(params.tools),
      tool_choice: 'auto',
      stream: false,
    }

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (e) {
      throw new Error(
        `Ollama is not reachable at ${this.baseUrl} — start it with 'ollama serve'`
      )
    }

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Ollama API error ${res.status}: ${err}`)
    }

    const data = await res.json() as OAIResponse
    return fromOAIResponse(data)
  }
}
