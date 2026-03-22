// Wolf-Fin — Anthropic SDK LLM provider

import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js'

const client = new Anthropic()

export class AnthropicProvider implements LLMProvider {
  async createMessage(params: LLMCreateParams): Promise<LLMResponse> {
    const res = await client.messages.create({
      model: params.model,
      max_tokens: params.max_tokens,
      system: params.system,
      ...(params.tools.length > 0 ? { tools: params.tools } : {}),
      messages: params.messages,
    })
    return {
      stop_reason: res.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
      content: res.content as Array<Anthropic.TextBlock | Anthropic.ToolUseBlock>,
      usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
    }
  }
}
